import type { Candidate, Resolution, Server } from './types.ts'
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

async function fromServers(servers: Server[], rung: 'reachable' | 'launched') {
  if (!servers.length) return null
  const hw = await detectHardware()
  // We allocate the weights ourselves only on the launch rung.
  const mode = rung === 'launched' ? 'free' : 'capacity'
  const all = await rank(servers, hw, mode)
  const best = all.find((c) => !c.reject)
  if (!best) return { all, resolved: null as Resolved | null }
  const resolved: Resolved = {
    rung,
    backend: best.server.backend,
    baseURL: best.server.baseURL,
    modelId: best.id,
    local: true,
    contextWindow: contextWindow(best, hw, mode),
    reason: 'largest chat model that fits the memory budget',
    rejected: rejectionsFrom(all, best),
    server: best.server,
  }
  return { all, resolved }
}

async function resolveOnce(): Promise<Resolved> {
  const rejected: { id: string; why: string }[] = []
  // Debug escape hatch for exercising a rung that would otherwise never win.
  const only = process.env.NEOROUTER_ONLY_RUNG

  // Rung 1 — something is already listening.
  const reachable = only && only !== 'reachable' ? [] : await reachableServers()
  const r1 = await fromServers(reachable, 'reachable')
  if (r1?.resolved) return r1.resolved
  if (r1) rejected.push(...r1.all.map((c) => ({ id: c.id, why: c.reject! })))

  // Rung 2 — a runtime is installed but idle.
  for (const l of only && only !== 'launched' ? [] : await launchable(reachable)) {
    const started = await launch(l, l.files[0])
    if (!started) continue
    const r2 = await fromServers([started.server], 'launched')
    if (r2?.resolved)
      return { ...r2.resolved, pid: started.pid, coldStartMs: started.coldStartMs }
  }

  // Rung 3 — off the machine.
  const [hosted] = await hostedServers()
  if (hosted) {
    const models = await hostedModels()
    return {
      rung: 'hosted',
      backend: hosted.backend,
      baseURL: hosted.baseURL,
      modelId: models[0] ?? 'openai',
      local: false,
      contextWindow: 8192,
      reason: 'no usable local model; fell through to a keyless hosted endpoint',
      rejected,
      server: hosted,
    }
  }

  throw new Error(
    'neorouter: nothing to talk to — no local server, no installed runtime, no network.',
  )
}

let pending: Promise<Resolved> | null = null

/** Resolution is memoised per process; the first call pays for discovery. */
export function resolveBackend(): Promise<Resolved> {
  pending ??= resolveOnce()
  return pending
}

export function reset(): void {
  pending = null
}
