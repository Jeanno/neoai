import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateText } from 'ai'
import {
  auto,
  checkKey,
  configDir,
  customEndpoints,
  envFor,
  fetchModels,
  localModels,
  PROVIDERS,
  providerById,
  reset,
  type Listing,
  type Verdict,
} from 'neorouter'
import { parseModelSpec, walkChain, type Chosen, type Entry, type Failure as ChainFailure } from './spec.ts'

/**
 * Setup's one core (SET-23): every choice, check and write. Front ends — the
 * terminal's `navi setup` and Raycast's Set Up Navi — only present what these
 * functions return and pass back what the user picked. Nothing here prompts.
 *
 * The core keeps no state: each call reads the config file afresh and each
 * write merges into what is on disk, so two front ends open at once cannot
 * undo each other's saves.
 */

/** 0 is the primary, 1 the fallback (SET-13). */
export type Slot = 0 | 1

/**
 * Lets a front end cancel a check in progress (SET-26). A cancelled call
 * rejects with the signal's reason (an AbortError) and saves nothing.
 */
export interface Cancel {
  signal?: AbortSignal
}

/** Everything the core touches outside itself, so it can be tested with fakes. */
export interface CoreDeps {
  /** The config file's contents, {} when absent. Throws when it is not valid JSON. */
  load: () => Promise<Record<string, any>>
  save: (config: Record<string, any>) => Promise<void>
  /** Where provider keys are looked for first (MOD-10). */
  env: Record<string, string | undefined>
  /**
   * Resolves a chain afresh: what was missing a moment ago may be running now.
   * With `launch: false` no local runtime is started (MOD-18).
   */
  resolve: (chain: Entry[], o: { launch: boolean }) => Promise<{ chosen: Chosen | null; failures: ChainFailure[] }>
  /** The models on servers already running; never launches. */
  localModels: (signal?: AbortSignal) => Promise<{ backend: string; id: string }[]>
  checkKey: (provider: string, key: string, signal?: AbortSignal) => Promise<Verdict>
  fetchModels: (server: { backend: string; baseURL: string; auth?: string }, signal?: AbortSignal) => Promise<Listing>
  /** Asks the model a one-line question and returns the reply (SET-11). */
  ask: (options: Chosen['options'], signal?: AbortSignal) => Promise<string>
}

/** The model that answers now. */
export interface Answering extends Chosen {
  /** Model first (SET-25): "qwen3-4b", or "claude-sonnet-5-5 on Anthropic". */
  label: string
}

/** A saved link that did not answer, in words (MOD-21). */
export interface LinkFailure {
  index: number
  label: string
  why: string
}

/** One saved link, in words. */
export interface Link {
  value: string
  label: string
}

export interface Status {
  primary: Link
  fallback: Link | null
  /** Links after the fallback, kept as they are (SET-17). */
  later: Link[]
  answering: Answering | null
  /** Each link tried before the one answering, or every link when none does, with why (MOD-21). */
  failures: LinkFailure[]
  /**
   * True when local links were looked for only on servers already running
   * (SET-24), so an installed runtime that is not running counted as nothing.
   */
  onlyRunning: boolean
}

/** Something to pick for a slot. `value` is the link saved; null clears the fallback. */
export interface Choice {
  value: string | null
  label: string
  /** Secondary text, such as a context size. Never a local server's app (SET-25). */
  detail?: string
  /** The slot holds this now. */
  current: boolean
}

export type Group = 'providers' | 'local' | 'custom'

export interface ProviderRow {
  id: string
  name: string
  /** Where to create a key (SET-6). */
  keyPage: string
  /** The environment variable that wins over a saved key. */
  env: string
  /** Where the key comes from, or null when there is none (SET-19). */
  key: 'env' | 'saved' | null
}

export interface CustomRow {
  name: string
  baseURL: string
  hasKey: boolean
}

export type Failure = { ok: false; why: 'rejected' | 'unreachable' | 'invalid'; message: string }

export type ModelList = { ok: true; recommended: Choice[]; all: Choice[] } | Failure

/** Help getting a local model (SET-5), for a front end to lay out as it likes. */
export const LOCAL_HELP = [
  {
    name: 'LM Studio',
    url: 'https://lmstudio.ai',
    steps:
      'Download a model in the Discover tab (a 4B or 8B model is a good start), then switch the server on in the Developer tab.',
  },
  { name: 'Ollama', url: 'https://ollama.com', steps: 'Then download a model in a terminal: ollama pull qwen3:4b' },
]

/**
 * What a front end says when nothing answers: the next step, not just the
 * failure. It names no command (SET-27); each front end adds how to open setup.
 */
export const NEXT_STEP =
  'Choose a model on this computer, from a provider with your key, or on your own endpoint; or start LM Studio or Ollama and try again.'

/** The chain's links as written, with the default spelled out (MOD-17). */
export function links(model: string | string[] | undefined): string[] {
  const parts = (Array.isArray(model) ? model : (model ?? '').split(',')).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : ['local']
}

const customNames = (config: Record<string, any>) => Object.keys(customEndpoints(config))

/** Two spellings of the same link, such as `local:x` and `x`, are the same pick. */
function same(a: string | null | undefined, b: string | null | undefined, custom: string[] = []): boolean {
  if (a == null || b == null) return false
  return JSON.stringify(parseModelSpec(a, custom)) === JSON.stringify(parseModelSpec(b, custom))
}

/**
 * The chain with one slot replaced (SET-17). null clears the fallback. Links
 * after the second stay.
 */
export function setSlotIn(parts: string[], slot: Slot, value: string | null, custom: string[] = []): string[] {
  const next = [...parts]
  if (slot === 0) {
    next[0] = value ?? next[0]
    // A fallback identical to the new primary would only be tried twice.
    if (same(next[1], next[0], custom)) next.splice(1, 1)
  } else if (value === null) next.splice(1, 1)
  else next[1] = value
  return next
}

const nameOf = (provider: string) => providerById(provider)?.name ?? provider

/**
 * A resolved model in words, model first (SET-25): a local model by its id
 * alone, never the app serving it (RAY-9); a provider or custom model with the
 * provider's or endpoint's name, which the user picked.
 */
export function modelLabel(chosen: { backend: string; modelId: string; local: boolean; entry?: Entry }): string {
  // A custom endpoint on this computer is still named (MOD-20).
  const runtime = chosen.local && chosen.entry?.where !== 'remote'
  return runtime ? chosen.modelId : `${chosen.modelId} on ${nameOf(chosen.backend)}`
}

/** What one link means, in words. */
export function labelFor(part: string, custom: string[] = []): string {
  return entryLabel(parseModelSpec(part, custom)[0])
}

/** One parsed link, in words. */
export function entryLabel(e: Entry): string {
  if (e.where === 'remote') return e.id ? `${e.id} on ${nameOf(e.provider!)}` : 'any free OpenRouter model'
  if (e.id) return `${e.id} on this computer`
  return e.prefer === 'fast' ? 'any local model (fastest)' : 'the largest local model'
}

/** One link, as a slot: "The primary", "The fallback", "Link 3". */
function slotName(index: number): string {
  return ['the primary', 'the fallback'][index] ?? `link ${index + 1}`
}

const capital = (s: string) => s[0].toUpperCase() + s.slice(1)

/**
 * SET-1: one sentence, then a line for each link that failed, with why
 * (MOD-21). `strong` marks the model's name for a front end that can. With
 * `onlyRunning` (SET-24), nothing found means nothing running.
 */
export function describe(
  answering: Answering | null,
  strong = (s: string) => s,
  { onlyRunning = false, failures = [] }: { onlyRunning?: boolean; failures?: LinkFailure[] } = {},
): string {
  const failed = failures.map((f) => `\n- ${capital(slotName(f.index))}, ${f.label}: ${f.why}.`).join('')
  if (!answering)
    return (onlyRunning ? "navi can't find a running model to answer with." : "navi can't find a model to answer with.") + failed
  const where = answering.local ? 'on this computer' : 'REMOTE: prompts leave this computer'
  // A pin replaced under MOD-19 is named, so the swap is never silent.
  const gone = answering.replaced ? ` The pinned ${answering.replaced} is gone; it serves only this model now.` : ''
  return `navi answers with ${strong(answering.label)}, ${slotName(answering.index)} (${where}).${gone}${failed}`
}

/**
 * Waits for a check, unless the signal aborts first (SET-26). Some checks
 * (a resolution shared through neorouter's memo) cannot be stopped midway;
 * their result is then dropped instead.
 */
async function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  signal.throwIfAborted()
  let stop: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

/** A base URL as typed, made comparable: trimmed, no trailing slash. */
function cleanURL(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function setupCore(d: CoreDeps) {
  /** Read, change, write: only the fields setup sets are touched (SET-9). */
  const update = async (change: (config: Record<string, any>) => Record<string, any>) => {
    const config = await d.load()
    await d.save(change(config))
  }

  const keyFor = (config: Record<string, any>, id: string): { key: string; from: 'env' | 'saved' } | null => {
    const env = envFor(id)
    const fromEnv = env && d.env[env]
    if (fromEnv) return { key: fromEnv, from: 'env' }
    const saved = config.keys?.[id]
    return typeof saved === 'string' && saved ? { key: saved, from: 'saved' } : null
  }

  const answeringFor = (chosen: Chosen | null): Answering | null => chosen && { ...chosen, label: modelLabel(chosen) }

  /** Marks the current pick and drops the primary from the fallback's lists (SET-18). */
  const choicesFor = async (slot: Slot, rows: Omit<Choice, 'current'>[]): Promise<Choice[]> => {
    const config = await d.load()
    const parts = links(config.model)
    const custom = customNames(config)
    const current = parts[slot]
    return rows
      .filter((r) => slot === 0 || !same(r.value, parts[0], custom))
      .map((r) => ({ ...r, current: r.value === null ? current === undefined : same(r.value, current, custom) }))
  }

  /** A server's models as choices saved under `prefix:` (MOD-4). */
  const listChoices = async (
    slot: Slot,
    prefix: string,
    server: { backend: string; baseURL: string; auth?: string },
    recommended: string[] = [],
    signal?: AbortSignal,
  ): Promise<ModelList> => {
    const listing = await cancellable(d.fetchModels(server, signal), signal)
    signal?.throwIfAborted()
    if (!listing.ok) return listing
    const ids = listing.models.map((m) => m.id)
    const row = (id: string) => {
      const n = listing.models.find((m) => m.id === id)?.contextWindow
      return { value: `${prefix}:${id}`, label: id, ...(n && { detail: `${Math.round(n / 1024)}k context` }) }
    }
    return {
      ok: true,
      // One the provider no longer offers is not shown (SET-20).
      recommended: await choicesFor(slot, recommended.filter((id) => ids.includes(id)).map(row)),
      all: await choicesFor(slot, [...ids].sort().map(row)),
    }
  }

  /**
   * The slots and what answers now (SET-1, SET-13). `launch: false` looks only
   * at servers already running, for the first screen (SET-24).
   */
  async function status({ signal, launch = true }: Cancel & { launch?: boolean } = {}): Promise<Status> {
    const config = await d.load()
    const custom = customNames(config)
    const parts = links(config.model)
    const link = (value: string): Link => ({ value, label: labelFor(value, custom) })
    const chain = parseModelSpec(parts, custom)
    const { chosen, failures } = await cancellable(d.resolve(chain, { launch }), signal)
    return {
      primary: link(parts[0]),
      fallback: parts[1] ? link(parts[1]) : null,
      later: parts.slice(2).map(link),
      answering: answeringFor(chosen),
      failures: failures.map((f) => ({ index: f.index, label: labelFor(parts[f.index], custom), why: f.why })),
      onlyRunning: !launch,
    }
  }

  /** Why a name cannot be used for a custom endpoint, or null when it can (MOD-15). */
  function checkCustomName(name: string): string | null {
    const n = name.trim()
    if (!n) return 'A name is needed.'
    if (n === 'local' || providerById(n)) return `${n} is taken by ${n === 'local' ? 'local models' : nameOf(n)}; choose another name.`
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n)) return 'Use letters, digits, dots, dashes or underscores.'
    return null
  }

  return {
    /** The config, or a thrown error when the file is not valid JSON (SET-9). */
    load: () => d.load(),

    status,

    /** The first step of changing a slot: three groups, and "none" for the fallback (SET-18). */
    async slotMenu(slot: Slot): Promise<{ groups: { id: Group; label: string }[]; none: Choice | null }> {
      const groups: { id: Group; label: string }[] = [
        { id: 'providers', label: 'Providers' },
        { id: 'local', label: 'Local' },
        { id: 'custom', label: 'Custom' },
      ]
      const none = slot === 1 ? (await choicesFor(1, [{ value: null, label: 'none' }]))[0] : null
      return { groups, none }
    },

    /** The providers, marking those with a key (SET-19). */
    async providers(): Promise<ProviderRow[]> {
      const config = await d.load()
      return PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        keyPage: p.keyPage,
        env: p.env,
        key: keyFor(config, p.id)?.from ?? null,
      }))
    },

    /**
     * Checks a key with the provider and saves it to `keys.<provider>` only
     * when accepted (SET-6). A rejected key, or one that could not be checked,
     * is not saved.
     */
    async saveKey(provider: string, key: string, { signal }: Cancel = {}): Promise<{ ok: true } | Failure> {
      const p = providerById(provider)
      const k = key.trim()
      if (!p) return { ok: false, why: 'invalid', message: `${provider} is not a provider.` }
      if (!k) return { ok: false, why: 'invalid', message: 'No key was entered. Nothing was saved.' }
      const verdict = await cancellable(d.checkKey(provider, k, signal), signal)
      // A check cancelled after it was answered still saves nothing (SET-26).
      signal?.throwIfAborted()
      if (verdict === 'rejected') return { ok: false, why: 'rejected', message: `${p.name} didn't accept that key. Nothing was saved.` }
      if (verdict === 'unreachable')
        return {
          ok: false,
          why: 'unreachable',
          message: `Couldn't reach ${p.name} to check the key. Nothing was saved; check your connection and try again.`,
        }
      await update((c) => ({ ...c, keys: { ...c.keys, [provider]: k } }))
      return { ok: true }
    },

    /**
     * Deletes `keys.<provider>` (SET-28). `still` names the environment
     * variable that keeps the provider keyed, when one does.
     */
    async removeKey(provider: string): Promise<{ ok: true; still?: string } | Failure> {
      const p = providerById(provider)
      if (!p) return { ok: false, why: 'invalid', message: `${provider} is not a provider.` }
      const config = await d.load()
      if (!config.keys || !(provider in config.keys)) return { ok: false, why: 'invalid', message: `No ${p.name} key is saved.` }
      await update((c) => {
        const { [provider]: _, ...keys } = c.keys ?? {}
        return { ...c, keys }
      })
      return { ok: true, ...(d.env[p.env] && { still: p.env }) }
    },

    /** A provider's hand-picked models still on offer, then all of them (SET-20). */
    async providerModels(provider: string, slot: Slot, { signal }: Cancel = {}): Promise<ModelList> {
      const p = providerById(provider)
      if (!p) return { ok: false, why: 'invalid', message: `${provider} is not a provider.` }
      const key = keyFor(await d.load(), provider)
      if (!key) return { ok: false, why: 'invalid', message: `${p.name} has no key yet.` }
      const list = await listChoices(slot, p.id, { backend: p.id, baseURL: p.baseURL, auth: key.key }, p.recommended, signal)
      if (!list.ok && list.why === 'rejected') return { ...list, message: `${p.name} no longer accepts the saved key.` }
      if (!list.ok) return { ...list, message: `Couldn't get ${p.name}'s models (${list.message}).` }
      return list
    },

    /**
     * Every model on the running local servers, by id alone (SET-21, SET-25),
     * then "any local model". Nothing is launched.
     */
    async localModels(slot: Slot, { signal }: Cancel = {}): Promise<Choice[]> {
      const models = await cancellable(d.localModels(signal), signal)
      signal?.throwIfAborted()
      // Two servers offering the same id are one choice: the link names the model, not the server.
      const ids = [...new Set(models.map((m) => m.id))]
      return choicesFor(slot, [
        ...ids.map((id) => ({ value: `local:${id}`, label: id })),
        { value: 'local', label: 'any local model (fastest)' },
      ])
    },

    /**
     * Looks for a local model again (SET-5). A probe, not just a listing: it
     * starts an installed runtime that is not running.
     */
    async recheckLocal({ signal }: Cancel = {}): Promise<Answering | null> {
      return answeringFor((await cancellable(d.resolve([{ where: 'local', prefer: 'fast' }], { launch: true }), signal)).chosen)
    },

    /** Saved custom endpoints (SET-22). */
    async customs(): Promise<CustomRow[]> {
      return Object.entries(customEndpoints(await d.load())).map(([name, c]) => ({
        name,
        baseURL: c.baseURL,
        hasKey: !!c.key,
      }))
    },

    checkCustomName,

    /**
     * Checks an endpoint by listing its models, then saves it under
     * `custom.<name>` (SET-22). A URL without its `/v1` is tried with it too.
     * Saving under an existing name replaces that endpoint.
     */
    async addCustom(
      input: { name: string; baseURL: string; key?: string },
      { signal }: Cancel = {},
    ): Promise<{ ok: true; baseURL: string } | Failure> {
      const name = input.name.trim()
      const bad = checkCustomName(name)
      if (bad) return { ok: false, why: 'invalid', message: bad }
      const url = cleanURL(input.baseURL)
      if (!/^https?:\/\/[^\s/]+/.test(url)) return { ok: false, why: 'invalid', message: 'The base URL starts with http:// or https://.' }
      const key = input.key?.trim() || undefined
      const tries = /\/v\d+$/.test(url) ? [url] : [url, `${url}/v1`]
      let last: Listing | null = null
      for (const baseURL of tries) {
        last = await cancellable(d.fetchModels({ backend: name, baseURL, ...(key && { auth: key }) }, signal), signal)
        signal?.throwIfAborted()
        if (last.ok) {
          await update((c) => ({ ...c, custom: { ...c.custom, [name]: { baseURL, ...(key && { key }) } } }))
          return { ok: true, baseURL }
        }
        if (last.why === 'rejected') break
      }
      const why = last && !last.ok ? last.why : 'unreachable'
      return {
        ok: false,
        why,
        message:
          why === 'rejected'
            ? `${url} refused ${key ? 'that key' : 'to list models without a key'}. Nothing was saved.`
            : `Couldn't list models at ${url}. Nothing was saved; is it an OpenAI-compatible server, and is it running?`,
      }
    },

    /**
     * Deletes `custom.<name>` (SET-28), unless a link in the chain uses it:
     * that link would then mean something else, or nothing.
     */
    async removeCustom(name: string): Promise<{ ok: true } | Failure> {
      const config = await d.load()
      if (!customEndpoints(config)[name]) return { ok: false, why: 'invalid', message: `No endpoint is saved as ${name}.` }
      const parts = links(config.model)
      const used = parseModelSpec(parts, customNames(config)).findIndex((e) => e.where === 'remote' && e.provider === name)
      if (used >= 0) {
        const slot = ['primary model', 'fallback'][used] ?? `link ${used + 1}`
        return { ok: false, why: 'invalid', message: `${name} answers as the ${slot}; change that first. Nothing was removed.` }
      }
      await update((c) => {
        const { [name]: _, ...custom } = c.custom ?? {}
        return { ...c, custom }
      })
      return { ok: true }
    },

    /** A custom endpoint's models (SET-22). */
    async customModels(name: string, slot: Slot, { signal }: Cancel = {}): Promise<ModelList> {
      const c = customEndpoints(await d.load())[name]
      if (!c) return { ok: false, why: 'invalid', message: `No endpoint is saved as ${name}.` }
      const server = { backend: name, baseURL: c.baseURL, ...(c.key && { auth: c.key }) }
      const list = await listChoices(slot, name, server, [], signal)
      if (!list.ok) return { ...list, message: `Couldn't get ${name}'s models (${list.message}).` }
      return list
    },

    /**
     * Saves a pick into a slot as `[primary, fallback, ...later]` (SET-17) and
     * resolves the chain again (SET-11). null clears the fallback.
     */
    async setSlot(slot: Slot, value: string | null): Promise<{ changed: boolean; status: Status }> {
      const config = await d.load()
      const parts = links(config.model)
      const next = setSlotIn(parts, slot, value, customNames(config))
      const changed = JSON.stringify(next) !== JSON.stringify(parts)
      if (changed) await update((c) => ({ ...c, model: next }))
      return { changed, status: await status() }
    },

    /** A one-line test question to the model that answers (SET-11). */
    async test(
      answering: Answering,
      { signal }: Cancel = {},
    ): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
      try {
        const reply = (await cancellable(d.ask(answering.options, signal), signal)).trim()
        return reply ? { ok: true, reply } : { ok: false, error: 'it returned an empty reply' }
      } catch (e) {
        // Cancelled is not a failure of the model: it is passed on (SET-26).
        if (signal?.aborted) throw signal.reason
        return { ok: false, error: e instanceof Error ? e.message.replace(/^neorouter: /, '') : String(e) }
      }
    },
  }
}

export type SetupCore = ReturnType<typeof setupCore>

/** Reads the config file: {} when absent, an error when it is not a JSON object. */
export async function loadConfig(dir = configDir()): Promise<Record<string, any>> {
  const file = join(dir, 'config.json')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`)
  return parsed as Record<string, any>
}

/** Writes the config file with mode 0600, since it may hold a key (SET-10). */
export async function saveConfig(config: Record<string, any>, dir = configDir()): Promise<void> {
  const file = join(dir, 'config.json')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // Written aside and renamed, so a crash never leaves half a config.
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await rename(tmp, file)
  await chmod(file, 0o600)
}

/** The real filesystem, network and models behind the core. */
export function realDeps(dir = configDir()): CoreDeps {
  return {
    load: () => loadConfig(dir),
    save: (config) => saveConfig(config, dir),
    env: process.env,
    resolve: async (chain, { launch }) => {
      // Failures are memoised too, and setup asks again after things change.
      reset()
      return walkChain(chain, { launch })
    },
    localModels: (signal) => localModels(signal),
    checkKey: (provider, key, signal) => checkKey(provider, key, fetch, signal),
    fetchModels: (server, signal) => fetchModels(server, fetch, signal),
    ask: async (options, signal) => {
      const timeout = AbortSignal.timeout(120_000)
      const { text } = await generateText({
        model: auto(options),
        prompt: 'Say hello in one short sentence.',
        abortSignal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      })
      return text
    },
  }
}
