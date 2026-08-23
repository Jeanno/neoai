import type { Server } from './types.ts'
import { readKey } from './config.ts'

/**
 * Keyless endpoints. This tier is inherently unstable — anything free and
 * unauthenticated rate-limits hard and can disappear — so it is last, and the
 * resolution always reports local:false so callers can tell.
 */
const HOSTED: (Server & { probe: string })[] = [
  {
    backend: 'pollinations',
    baseURL: 'https://text.pollinations.ai/openai',
    probe: 'https://text.pollinations.ai/models',
  },
]

const OPENROUTER = 'https://openrouter.ai/api/v1'

/**
 * Above the keyless tier when a key is present: it streams, it does not need
 * pacing, and its free models are far beyond anything anonymous. Absent a key
 * the rung simply does not exist, so nothing has to be configured to get the
 * old behaviour.
 */
async function openrouter(): Promise<Server | null> {
  const key = await readKey('openrouterKey')
  return key ? { backend: 'openrouter', baseURL: OPENROUTER, auth: key } : null
}

export async function hostedServers(): Promise<Server[]> {
  const keyed = await openrouter()
  const hits = await Promise.all(
    HOSTED.map(async (h) => {
      try {
        const r = await fetch(h.probe, { signal: AbortSignal.timeout(4000) })
        return r.ok ? { backend: h.backend, baseURL: h.baseURL } : null
      } catch {
        return null
      }
    }),
  )
  return [...(keyed ? [keyed] : []), ...hits.filter((s): s is Server => s !== null)]
}

export async function hostedModels(server?: Server): Promise<string[]> {
  if (server?.backend === 'openrouter') {
    try {
      const r = await fetch(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(8000) })
      return freeChatModels(await r.json())
    } catch {
      return []
    }
  }
  try {
    const r = await fetch('https://text.pollinations.ai/models', {
      signal: AbortSignal.timeout(4000),
    })
    const j = (await r.json()) as any
    const list = Array.isArray(j) ? j : (j.models ?? [])
    return list.map((m: any) => (typeof m === 'string' ? m : m.name ?? m.id)).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * The anonymous tier admits one in-flight request per IP and rejects bursts even
 * when they are sequential. Measured: 12/12 succeed at 3s spacing, while
 * back-to-back calls fail unpredictably. So hosted traffic is both serialised
 * and paced, and callers pay in latency rather than in random failures.
 */
const MIN_INTERVAL_MS = 3000
let tail: Promise<unknown> = Promise.resolve()
let last = 0

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = last + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      return await fn()
    } finally {
      last = Date.now()
    }
  }
  const next = tail.then(run, run)
  tail = next.catch(() => {})
  return next
}

/**
 * Free ids come and go, so the choice is made from the live catalogue rather
 * than hardcoded. Selects on what a model *outputs*: several free models accept
 * images or video and answer in text, and requiring an exact 'text->text'
 * modality would drop the strongest of them.
 */
export function freeChatModels(catalog: any): string[] {
  const models = catalog?.data
  if (!Array.isArray(models)) return []
  return models
    .filter(
      (m: any) =>
        m?.pricing?.prompt === '0' &&
        m?.pricing?.completion === '0' &&
        String(m?.architecture?.modality ?? '').endsWith('->text'),
    )
    .sort((a: any, b: any) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .map((m: any) => m.id)
}
