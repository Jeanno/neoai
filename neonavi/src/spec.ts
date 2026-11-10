import { wrapLanguageModel } from 'ai'
import { auto, CallError, diagnose, probe, providerById, type AutoOptions, type Trouble } from 'neorouter'
import { thinkTags } from './think.ts'

export interface Entry {
  /** 'remote' is a provider or custom endpoint; prompts leave the machine. */
  where: 'remote' | 'local'
  /** The provider id or custom endpoint name, for a remote link. */
  provider?: string
  /** Exact model id, when one was named instead of an alias. */
  id?: string
  /** Which local model to prefer when none was named. */
  prefer?: 'fast'
}

/** Nothing leaves the machine until someone chooses a provider (MOD-17). */
const DEFAULT: Entry[] = [{ where: 'local', prefer: 'fast' }]

/** A fallback should answer quickly, so bare 'local' is the quick model. */
const ALIASES: Record<string, Entry> = {
  // Kept for configs written before providers (MOD-3).
  remote: { where: 'remote', provider: 'openrouter' },
  local: { where: 'local', prefer: 'fast' },
  fast: { where: 'local', prefer: 'fast' },
  best: { where: 'local' },
}

/**
 * One field holds either an alias, an exact model id, or an ordered list of
 * them — the list *is* the fallback chain (MOD-1, MOD-4). `<name>:<model>`
 * names a provider, or a custom endpoint from `custom` (whose names are passed
 * in, since Ollama tags such as `qwen3:4b` look the same). A bare id with a
 * slash is OpenRouter's; anything else is a local model.
 */
export function parseModelSpec(value: string | string[] | undefined, custom: string[] = []): Entry[] {
  if (value === undefined) return DEFAULT
  const parts = (Array.isArray(value) ? value : value.split(','))
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return DEFAULT
  return parts.map((p): Entry => {
    if (ALIASES[p]) return ALIASES[p]
    // LM Studio names models like `qwen/qwen3-4b`; the prefix keeps them local.
    if (p.startsWith('local:')) return { where: 'local', id: p.slice('local:'.length) }
    const at = p.indexOf(':')
    const name = at > 0 ? p.slice(0, at) : ''
    if (name && p.length > at + 1 && (providerById(name) || custom.includes(name)))
      return { where: 'remote', provider: name, id: p.slice(at + 1) }
    return p.includes('/') ? { where: 'remote', provider: 'openrouter', id: p } : { where: 'local', id: p }
  })
}

export interface Chosen {
  entry: Entry
  /** Which link answered: 0 is the primary, 1 the fallback. */
  index: number
  options: Pick<AutoOptions, 'prefer' | 'model' | 'scope' | 'provider' | 'think'>
  /** What the resolved backend can hold, in tokens. */
  contextWindow: number
  backend: string
  modelId: string
  /** False when prompts leave the machine. */
  local: boolean
  /** The pinned model that had gone, when the endpoint's only model answered instead (MOD-19). */
  replaced?: string
}

/** What auto() is given for one link: scoped to the backend it names (MOD-6). */
export function optionsFor(entry: Entry): Chosen['options'] {
  // Every model thinks as its server would (MOD-50); `think` in its options may say otherwise.
  if (entry.where === 'local') return { prefer: entry.prefer, model: entry.id, scope: 'local' }
  return { model: entry.id, provider: entry.provider }
}

/** A link that did not answer, and why (MOD-21). */
export interface Failure {
  entry: Entry
  index: number
  why: string
}

/**
 * Walks the chain and returns the first link that actually resolves (MOD-5).
 * A link fails when its key is missing, its server is unreachable, or its
 * model is not on offer — and then the next one is tried, which is what makes
 * the list a fallback chain rather than a preference. `launch: false` starts
 * no local runtime (MOD-18). Every link tried before is in `failures`, with
 * why it failed (MOD-21).
 */
export async function walkChain(
  chain: Entry[],
  { launch = true }: { launch?: boolean } = {},
): Promise<{ chosen: Chosen | null; failures: Failure[] }> {
  const failures: Failure[] = []
  for (const [index, entry] of chain.entries()) {
    const options = optionsFor(entry)
    // Without launching, a local link looks only at running servers (MOD-18).
    // The options handed back stay the link's own, so the model built from
    // them may still launch when it is used.
    const probed = !launch && options.scope === 'local' ? { ...options, scope: 'running' as const } : options
    const got = await probe(probed)
    if (!got) {
      failures.push({ entry, index, why: (await diagnose(probed)) ?? 'it did not answer' })
      continue
    }
    const chosen: Chosen = {
      entry,
      index,
      options,
      contextWindow: got.contextWindow,
      backend: got.backend,
      modelId: got.modelId,
      local: got.local,
      ...(got.replaced && { replaced: got.replaced }),
    }
    return { chosen, failures }
  }
  return { chosen: null, failures }
}

/** walkChain without the reasons. */
export async function resolveChain(chain: Entry[], options: { launch?: boolean } = {}): Promise<Chosen | null> {
  return (await walkChain(chain, options)).chosen
}

/** What one link of the chain is asked with, from `"modelOptions"` in the config (MOD-24). */
export interface LinkOptions {
  /** At most this many tokens in each answer, unless a caller asks otherwise. */
  maxTokens?: number
  /** At most this many tokens in each answer, whatever a caller asks (MOD-27). */
  tokenCap?: number
  temperature?: number
  /** false asks a reasoning model not to think, where its server has a way (MOD-50). */
  think?: boolean
}

/**
 * The options for a link (MOD-24): those given under a key that names the
 * same model (`"local"` and `"fast"` are one), merged in the order written;
 * a value that is not one of these is left out (MOD-25).
 */
export function linkOptions(entry: Entry, given: unknown, custom: string[] = []): LinkOptions {
  if (!given || typeof given !== 'object' || Array.isArray(given)) return {}
  const same = JSON.stringify(entry)
  const out: LinkOptions = {}
  for (const [key, raw] of Object.entries(given as Record<string, unknown>)) {
    const named = parseModelSpec(key, custom)
    if (named.length !== 1 || JSON.stringify(named[0]) !== same || !raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (Number.isInteger(o.maxTokens) && (o.maxTokens as number) > 0) out.maxTokens = o.maxTokens as number
    if (Number.isInteger(o.tokenCap) && (o.tokenCap as number) > 0) out.tokenCap = o.tokenCap as number
    if (typeof o.temperature === 'number' && o.temperature >= 0 && o.temperature <= 2) out.temperature = o.temperature
    if (typeof o.think === 'boolean') out.think = o.think
  }
  return out
}

/** A token count asked for, held to the link's cap (MOD-27). */
export const capTokens = (asked: number, o: LinkOptions) => (o.tokenCap !== undefined ? Math.min(asked, o.tokenCap) : asked)

/** The model for a chosen link, asked as its options say (MOD-24). */
export function modelFor(chosen: Pick<Chosen, 'entry' | 'options'>, config: Record<string, unknown>): ReturnType<typeof auto> {
  const o = linkOptions(chosen.entry, config.modelOptions, Object.keys((config.custom as object | undefined) ?? {}))
  return withOptions(auto({ ...chosen.options, ...(o.think !== undefined && { think: o.think }) }), o)
}

/**
 * A model asked with a link's token cap and temperature, unless a caller asks
 * otherwise (MOD-24), and with thinking written into its text taken out (MOD-26).
 */
export function withOptions(model: ReturnType<typeof auto>, o: LinkOptions): ReturnType<typeof auto> {
  const wrapped = wrapLanguageModel({
    model,
    middleware: [
      {
        // What a caller asks for itself still wins, but for the cap (MOD-27).
        transformParams: async ({ params }) => {
          const asked = params.maxOutputTokens ?? o.maxTokens ?? o.tokenCap
          return {
            ...params,
            ...(asked !== undefined && { maxOutputTokens: capTokens(asked, o) }),
            ...(params.temperature == null && o.temperature !== undefined && { temperature: o.temperature }),
          }
        },
      },
      thinkTags,
    ],
  })
  // Still streams tool calls as auto() does, so the harness need not ask for it whole.
  return Object.assign(wrapped, { streamsToolCalls: (model as { streamsToolCalls?: boolean }).streamsToolCalls })
}

/** A failed call's trouble in words, said after the link's name (MOD-43). */
const TROUBLE_WORDS: Record<Trouble, string> = {
  unreachable: 'could not be reached',
  key: 'had its key refused',
  gone: 'is no longer served',
  busy: 'is busy or at capacity',
  loading: 'is not loaded',
  credit: 'is out of credit',
  server: 'had a server error',
  request: 'refused the request',
}

/** A failed call's kind and words (MOD-41); an error that is not a call's is a link that did not resolve. */
export function troubleIn(e: unknown): { trouble: Trouble | 'unresolved'; words: string; detail: string } {
  // By shape as well, should two copies of neorouter be loaded.
  if (e instanceof CallError || (e instanceof Error && e.name === 'CallError' && (e as CallError).trouble in TROUBLE_WORDS)) {
    const c = e as CallError
    return { trouble: c.trouble, words: TROUBLE_WORDS[c.trouble], detail: c.detail }
  }
  const message = (e instanceof Error ? e.message : String(e)).replace(/^neorouter: /, '')
  return { trouble: 'unresolved', words: 'did not answer', detail: message }
}

