import type { Candidate, Prefer, Resolution, Server } from './types.ts'
import { detectHardware } from './hardware.ts'
import { reachableServers } from './discover.ts'
import { rank, contextWindow, evaluate } from './select.ts'
import { launchable, launch } from './launch.ts'
import { hostedServers, hostedModels } from './hosted.ts'

export interface Resolved extends Resolution {
  server: Server
}

function rejectionsFrom(all: Candidate[], chosen: Candidate) {
  return all
    .filter((c) => c !== chosen)
    .map((c) => ({ id: c.id, why: c.reject ?? `outranked by ${chosen.id}` }))
}

async function fromServers(servers: Server[], rung: 'reachable' | 'launched', prefer?: Prefer) {
  if (!servers.length) return null
  const hw = await detectHardware()
  // We allocate the weights ourselves only on the launch rung.
  const mode = rung === 'launched' ? 'free' : 'capacity'
  const all = await rank(servers, hw, mode, prefer)
  const best = all.find((c) => !c.reject)
  if (!best) return { all, resolved: null as Resolved | null }
  const resolved: Resolved = {
    rung,
    backend: best.server.backend,
    baseURL: best.server.baseURL,
    modelId: best.id,
    local: true,
    contextWindow: contextWindow(best, hw, mode),
    reason:
      prefer === 'fast'
        ? 'smallest usable chat model, for latency'
        : 'largest chat model that fits the memory budget',
    rejected: rejectionsFrom(all, best),
    server: best.server,
  }
  return { all, resolved }
}

export type Rung = 'reachable' | 'launched' | 'keyed' | 'keyless'

/**
 * Local first unless asked otherwise: nothing leaves the machine because of a
 * default. Remote-first raises only the *keyed* endpoint, never the keyless
 * one — falling back from a missing key to an anonymous endpoint would be
 * slower, flakier, and still off-machine, which is worse than the laptop on
 * every axis. So the keyless tier stays last in both orders.
 */
export function rungOrder(remote: boolean): Rung[] {
  return remote
    ? ['keyed', 'reachable', 'launched', 'keyless']
    : ['reachable', 'launched', 'keyed', 'keyless']
}

async function resolveOnce(prefer?: Prefer, remote = false): Promise<Resolved> {
  const rejected: { id: string; why: string }[] = []
  // Debug escape hatch for exercising a rung that would otherwise never win.
  const only = process.env.NEOROUTER_ONLY_RUNG

  let reachable: Server[] = []

  const tryReachable = async (): Promise<Resolved | null> => {
    reachable = only && only !== 'reachable' ? [] : await reachableServers()
    const r1 = await fromServers(reachable, 'reachable', prefer)
    if (r1?.resolved) return r1.resolved
    if (r1) rejected.push(...r1.all.map((c) => ({ id: c.id, why: c.reject! })))
    return null
  }

  const tryLaunched = async (): Promise<Resolved | null> => {
    for (const l of only && only !== 'launched' ? [] : await launchable(reachable)) {
      const started = await launch(l, l.files[0])
      if (!started) continue
      const r2 = await fromServers([started.server], 'launched', prefer)
      if (r2?.resolved) return { ...r2.resolved, pid: started.pid, coldStartMs: started.coldStartMs }
    }
    return null
  }

  const tryHosted = (keyed: boolean) => async (): Promise<Resolved | null> => {
    if (only && only !== 'hosted') return null
    return hostedResolution(rejected, keyed)
  }

  const attempt = {
    reachable: tryReachable,
    launched: tryLaunched,
    keyed: tryHosted(true),
    keyless: tryHosted(false),
  }
  for (const rung of rungOrder(remote)) {
    const got = await attempt[rung]()
    if (got) return got
  }

  throw new Error(
    'neorouter: nothing to talk to — no local server, no installed runtime, no network.',
  )
}

async function hostedResolution(
  rejected: { id: string; why: string }[],
  keyed: boolean,
): Promise<Resolved | null> {
  const all = await hostedServers()
  const [hosted] = all.filter((s) => !!s.auth === keyed)
  if (hosted) {
    const models = await hostedModels(hosted)
    return {
      rung: 'hosted',
      backend: hosted.backend,
      baseURL: hosted.baseURL,
      modelId: models[0] ?? 'openai',
      local: false,
      contextWindow: 8192,
      reason:
        hosted.backend === 'openrouter'
          ? 'no usable local model; fell through to a free model on OpenRouter'
          : 'no usable local model; fell through to a keyless hosted endpoint',
      rejected,
      server: hosted,
    }
  }
  return null
}

/**
 * The caller never picked this model, so they are told which one answered —
 * once, on stderr, where it cannot corrupt piped stdout.
 */
function announce(r: Resolved): void {
  if (process.env.NEOROUTER_QUIET) return
  const where = r.local ? 'local' : 'REMOTE — prompts leave this machine'
  const cold = r.coldStartMs ? `, ${(r.coldStartMs / 1000).toFixed(1)}s cold start` : ''
  console.error(`neorouter: ${r.backend} · ${r.modelId} · ${where} (${r.rung}${cold})`)
}

// Keyed by preference: 'fast' and the default resolve to different models, so a
// single memo would hand the second caller the first caller's backend.
const pending = new Map<string, Promise<Resolved>>()

/** Resolution is memoised per process; the first call pays for discovery. */
export function resolveBackend(prefer?: Prefer, remote = false): Promise<Resolved> {
  const key = `${prefer ?? 'default'}:${remote ? 'remote' : 'local'}`
  let p = pending.get(key)
  if (!p) {
    p = resolveOnce(prefer, remote).then((r) => {
      announce(r)
      return r
    })
    pending.set(key, p)
  }
  return p
}

export function reset(): void {
  pending.clear()
}
