import type { Server } from './types.ts'
import { configDir, customEndpoints, readConfig, readKey } from './config.ts'
import { PROVIDERS, providerById } from './providers.ts'

/** One model a provider or custom endpoint lists. */
export interface RemoteModel {
  id: string
  /** Tokens, when the list says (MOD-12). */
  contextWindow?: number
  /** OpenRouter only: costs nothing and answers in text. */
  free?: boolean
}

export type Verdict = 'ok' | 'rejected' | 'unreachable'

export type Listing =
  | { ok: true; models: RemoteModel[] }
  | { ok: false; why: Exclude<Verdict, 'ok'>; message: string }

type Fetch = typeof fetch

/** A timeout, ended early too when the caller's signal aborts. */
export function within(ms: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms)
}

/**
 * The server a provider id or custom endpoint name stands for, or null when it
 * is unknown or is a provider without a key (MOD-7). `auth` is the Bearer token
 * chat requests carry.
 */
export async function remoteServer(
  name: string,
  dir = configDir(),
  env: Record<string, string | undefined> = process.env,
): Promise<Server | null> {
  const provider = providerById(name)
  if (provider) {
    const key = await readKey(name, dir, env)
    return key ? { backend: name, baseURL: provider.baseURL, auth: key } : null
  }
  const custom = customEndpoints(await readConfig(dir))[name]
  if (!custom) return null
  return { backend: name, baseURL: custom.baseURL, custom: true, ...(custom.key && { auth: custom.key }) }
}

/** Every provider with a key and every custom endpoint, for diagnostics. */
export async function remoteServers(dir = configDir()): Promise<Server[]> {
  const names = [...PROVIDERS.map((p) => p.id), ...Object.keys(customEndpoints(await readConfig(dir)))]
  const servers = await Promise.all(names.map((n) => remoteServer(n, dir)))
  return servers.filter((s) => s !== null)
}

/** Headers for listing a server's models. Never logged: they carry the key. */
export function modelHeaders(server: Server): Record<string, string> {
  if (!server.auth) return {}
  const custom = providerById(server.backend)?.listHeaders
  return custom ? custom(server.auth) : { authorization: `Bearer ${server.auth}` }
}

/** Field names the context window goes by, depending on who serves the list. */
const CONTEXT_FIELDS = ['context_length', 'context_window', 'max_context_length', 'max_model_len', 'inputTokenLimit', 'max_input_tokens']

export function parseModels(json: any): RemoteModel[] {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
  return list.flatMap((m: any): RemoteModel[] => {
    const raw = typeof m?.id === 'string' ? m.id : typeof m?.name === 'string' ? m.name : null
    if (!raw) return []
    // Gemini lists `models/gemini-…`; chat takes the bare id.
    const id = raw.replace(/^models\//, '')
    const n = CONTEXT_FIELDS.map((f) => Number(m[f])).find((v) => Number.isFinite(v) && v > 0)
    const free =
      m?.pricing?.prompt === '0' && m?.pricing?.completion === '0' && String(m?.architecture?.modality ?? '').endsWith('->text')
    return [{ id, ...(n && { contextWindow: n }), ...(free && { free: true }) }]
  })
}

/**
 * Free ids come and go, so `remote` picks from the live catalogue (MOD-9): the
 * free chat model with the most room. Free means answering in text, not taking
 * only text — several of the strongest free models also accept images.
 */
export function roomiestFree(models: RemoteModel[]): string[] {
  return models
    .filter((m) => m.free)
    .sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))
    .map((m) => m.id)
}

/**
 * 400 counts as a refusal: Gemini and xAI answer a bad key with 400, and a
 * plain GET has nothing else in it to be malformed.
 */
function classify(status: number): Exclude<Verdict, 'ok'> {
  return status === 400 || status === 401 || status === 403 ? 'rejected' : 'unreachable'
}

function modelsURL(server: Server): string {
  return server.baseURL + (providerById(server.backend)?.models ?? '/models')
}

/**
 * The server's live model list, or why there is none. `signal` lets the
 * caller give up early; a cancelled listing reads as unreachable.
 */
export async function fetchModels(server: Server, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<Listing> {
  let res: Response
  try {
    res = await fetcher(modelsURL(server), { headers: modelHeaders(server), signal: within(10_000, signal) })
  } catch (e) {
    return { ok: false, why: 'unreachable', message: `could not reach ${server.baseURL}` }
  }
  if (!res.ok) return { ok: false, why: classify(res.status), message: `${server.baseURL} answered ${res.status}` }
  try {
    return { ok: true, models: parseModels(await res.json()) }
  } catch {
    return { ok: false, why: 'unreachable', message: `${server.baseURL} did not answer with a model list` }
  }
}

/**
 * Whether a provider accepts a key (SET-6), with a call that needs it: a bad
 * key is 'rejected', no answer at all is 'unreachable'.
 */
export async function checkKey(
  providerId: string,
  key: string,
  fetcher: Fetch = fetch,
  signal?: AbortSignal,
): Promise<Verdict> {
  const p = providerById(providerId)
  if (!p) return 'rejected'
  const server: Server = { backend: p.id, baseURL: p.baseURL, auth: key }
  if (!p.check) {
    const listing = await fetchModels(server, fetcher, signal)
    return listing.ok ? 'ok' : listing.why
  }
  try {
    const res = await fetcher(p.baseURL + p.check, { headers: modelHeaders(server), signal: within(10_000, signal) })
    return res.ok ? 'ok' : classify(res.status)
  } catch {
    return 'unreachable'
  }
}
