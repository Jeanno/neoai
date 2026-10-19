import type { Server } from './types.ts'

/**
 * Keyless endpoints. This tier is inherently unstable — anything free and
 * unauthenticated rate-limits hard and can disappear — so it is last, reached
 * only by an unscoped auto(), and the resolution always reports local:false so
 * callers can tell. navi never uses it (MOD-6).
 */
const HOSTED: (Server & { probe: string })[] = [
  {
    backend: 'pollinations',
    baseURL: 'https://text.pollinations.ai/openai',
    probe: 'https://text.pollinations.ai/models',
  },
]

export async function hostedServers(): Promise<Server[]> {
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
  return hits.filter((s): s is Server => s !== null)
}

export async function hostedModels(): Promise<string[]> {
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
