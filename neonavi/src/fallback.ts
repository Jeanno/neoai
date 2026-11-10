import { diagnose, type Trouble } from 'neorouter'
import { modelFor, optionsFor, troubleIn, walkChain, type Chosen, type Entry } from './spec.ts'
import { entryLabel, modelLabel, nameOf, slotName } from './setup-core.ts'

/**
 * The chain as one model (MOD-40): a request goes to the link the session
 * started on, and to the next link that resolves when that one fails for
 * anything but the request's own fault. Front ends make it; the harness tells
 * it when a turn starts (HAR-14) and passes on what it says.
 */

type Model = ReturnType<typeof modelFor>
type CallOptions = Parameters<Model['doStream']>[0]

/** One link's failure, in words (MOD-41, MOD-43). */
export interface LinkTrouble {
  index: number
  /** "the model", "the backup", "link 3" (MOD-44). */
  slot: string
  /** The model as setup names it: "qwen3 on Darkbloom". */
  label: string
  /** The provider's or endpoint's name, for the short form: "Darkbloom". */
  server?: string
  trouble: Trouble | 'unresolved'
  /** "is busy or at capacity" — said after the slot. */
  words: string
  /** The status and the server's own words, short: "429 capacity (queueFull)". */
  detail: string
}

/** Another link answered for the one that failed (HAR-14). */
export interface FellBack {
  failed: LinkTrouble[]
  to: { index: number; slot: string; label: string; local: boolean }
  /** The model failed the turn before too, and was tried once only (MOD-40). */
  again: boolean
}

/** "the model, qwen3 on Darkbloom, is busy or at capacity (429 capacity)" (MOD-43). */
export function troubleLine(t: LinkTrouble): string {
  return `${t.slot}, ${t.label}, ${t.words}${t.detail ? ` (${t.detail})` : ''}`
}

/** What a turn says when another link answers (CLI-50): one line, without the leading dot. */
export function fellBackLine(e: FellBack): string {
  const again = e.again ? ' again' : ''
  const failed = e.failed
    .map((t) => `${t.slot} ${t.words}${t === e.failed[0] ? again : ''} (${[t.server, t.detail].filter(Boolean).join(': ')})`)
    .join('; ')
  const remote = e.to.local ? '' : ' (REMOTE: prompts leave this computer)'
  return `${failed}; ${e.to.slot}, ${e.to.label}, answers${remote}`
}

/** No link answered: each one tried, and why (MOD-43). */
export class ChainError extends Error {
  constructor(readonly failed: LinkTrouble[]) {
    super(failed.length === 1 ? troubleLine(failed[0]) : `no model in the chain answered: ${failed.map(troubleLine).join('; ')}`)
    this.name = 'ChainError'
  }
}

export interface ChainModel extends Model {
  /** A turn starts (HAR-14): a link that failed the last one is tried again, once (MOD-40). */
  newTurn(): void
  /** Called each time another link answers a turn; returns a way to stop listening. */
  listen(fn: (e: FellBack) => void): () => void
  /** The link that answered last. */
  readonly answering: Chosen
}

export interface ChainDeps {
  /** Resolves one link, or says why not (MOD-21). */
  resolve?: (entry: Entry, index: number) => Promise<Chosen | { why: string }>
  /** The model for a resolved link (MOD-24). */
  make?: (chosen: Chosen) => Model
}

const realResolve = async (entry: Entry, index: number): Promise<Chosen | { why: string }> => {
  const { chosen } = await walkChain([entry])
  if (chosen) return { ...chosen, index }
  return { why: (await diagnose(optionsFor(entry))) ?? 'it did not answer' }
}

/** Fewer retries for one call (MOD-42), keeping whatever else the caller asked of neorouter. */
function quick(options: CallOptions): CallOptions {
  const p = options.providerOptions ?? {}
  return { ...options, providerOptions: { ...p, neorouter: { ...(p.neorouter ?? {}), retries: 0 } } }
}

/**
 * The chain from the link the session started on (MOD-5) as one model that
 * moves on when a link fails at runtime (MOD-40). Links before `first` are not
 * tried: they failed to resolve when the session started.
 */
export function chainModel(chain: Entry[], first: Chosen, config: Record<string, unknown>, deps: ChainDeps = {}): ChainModel {
  const resolve = deps.resolve ?? realResolve
  const make = deps.make ?? ((c: Chosen) => modelFor(c, config))
  const home = first.index
  const links = new Map<number, { chosen: Chosen; model: Model } | { why: string }>([[home, { chosen: first, model: make(first) }]])
  // This turn's failures: not asked again until the next (MOD-40).
  let failedNow = new Map<number, LinkTrouble>()
  // Failed a turn and not answered since: tried once only, without retries.
  const doubted = new Set<number>()
  let doubtedAtStart = false
  let announced: number | undefined
  let current = home
  const listeners = new Set<(e: FellBack) => void>()

  const linkAt = async (i: number) => {
    let got = links.get(i)
    if (!got) {
      const r = await resolve(chain[i], i)
      got = 'why' in r ? r : { chosen: r, model: make(r) }
      // One that did not resolve is looked for again next turn (MOD-22 forgets it too).
      if (!('why' in got)) links.set(i, got)
    }
    return got
  }

  const failure = (i: number, chosen: Chosen | undefined, t: Pick<LinkTrouble, 'trouble' | 'words' | 'detail'>): LinkTrouble => ({
    index: i,
    slot: slotName(i),
    label: chosen ? modelLabel(chosen) : entryLabel(chain[i]),
    ...(chosen ? { server: nameOf(chosen.backend) } : chain[i].provider ? { server: nameOf(chain[i].provider!) } : {}),
    ...t,
  })

  async function call<K extends 'doStream' | 'doGenerate'>(kind: K, options: CallOptions): Promise<Awaited<ReturnType<Model[K]>>> {
    const failed: LinkTrouble[] = []
    for (let i = home; i < chain.length; i++) {
      const known = failedNow.get(i)
      if (known) {
        failed.push(known)
        continue
      }
      options.abortSignal?.throwIfAborted()
      const link = await linkAt(i)
      if ('why' in link) {
        const t = failure(i, undefined, { trouble: 'unresolved', words: 'did not answer', detail: link.why })
        failedNow.set(i, t)
        failed.push(t)
        continue
      }
      try {
        const asked = doubted.has(i) ? quick(options) : options
        const result = (await (link.model[kind] as (o: CallOptions) => Promise<unknown>)(asked)) as Awaited<ReturnType<Model[K]>>
        doubted.delete(i)
        current = i
        if (i !== home && announced !== i) {
          announced = i
          const e: FellBack = {
            failed,
            to: { index: i, slot: slotName(i), label: modelLabel(link.chosen), local: link.chosen.local },
            again: doubtedAtStart,
          }
          for (const fn of listeners) fn(e)
        }
        return result
      } catch (e) {
        // Stopped by the caller: not the link's failure, and nothing else is started.
        if (options.abortSignal?.aborted) throw e
        const t = failure(i, link.chosen, troubleIn(e))
        failed.push(t)
        // The request's own fault would fail anywhere (MOD-41): said, not passed on.
        if (t.trouble === 'request') throw new ChainError(failed)
        failedNow.set(i, t)
        doubted.add(i)
      }
    }
    throw new ChainError(failed)
  }

  const homeModel = (links.get(home) as { model: Model }).model
  const answeringLink = () => links.get(current) as { chosen: Chosen; model: Model }
  return {
    specificationVersion: 'v2',
    get provider() {
      return answeringLink().model.provider
    },
    get modelId() {
      return answeringLink().model.modelId
    },
    get supportedUrls() {
      return homeModel.supportedUrls
    },
    get answering() {
      return answeringLink().chosen
    },
    // Every neorouter model streams its tool calls; the harness need not ask for them whole.
    streamsToolCalls: (homeModel as { streamsToolCalls?: boolean }).streamsToolCalls,
    doStream: (options: CallOptions) => call('doStream', options),
    doGenerate: (options: CallOptions) => call('doGenerate', options),
    newTurn() {
      failedNow = new Map()
      announced = undefined
      doubtedAtStart = doubted.has(home)
      current = home
    },
    listen(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  } as ChainModel
}

/** The chain-model hooks a model has, when it is one (HAR-14). */
export function chainHooks(m: unknown): Pick<ChainModel, 'newTurn' | 'listen'> | undefined {
  const c = m as Partial<ChainModel> | undefined
  return c && typeof c.newTurn === 'function' && typeof c.listen === 'function' ? (c as ChainModel) : undefined
}
