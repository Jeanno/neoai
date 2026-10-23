import type { Candidate, Prefer, Resolution, Server } from './types.ts'
import { detectHardware } from './hardware.ts'
import { reachableServers } from './discover.ts'
import { rank, contextWindow, evaluate, pick } from './select.ts'
import { launchable, launch } from './launch.ts'
import { hostedServers, hostedModels } from './hosted.ts'
import { providerById } from './providers.ts'
import { chooseListed, fetchModels, onThisMachine, remoteServer } from './remote.ts'

export interface Resolved extends Resolution {
  server: Server
}

function rejectionsFrom(all: Candidate[], chosen: Candidate) {
  return all
    .filter((c) => c !== chosen)
    .map((c) => ({ id: c.id, why: c.reject ?? `outranked by ${chosen.id}` }))
}

async function fromServers(
  servers: Server[],
  rung: 'reachable' | 'launched',
  prefer?: Prefer,
  modelId?: string,
) {
  if (!servers.length) return null
  const hw = await detectHardware()
  // We allocate the weights ourselves only on the launch rung.
  const mode = rung === 'launched' ? 'free' : 'capacity'
  const all = await rank(servers, hw, mode, prefer)
  const best = pick(all, modelId)
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

export type Scope = 'keyed' | 'local' | 'running'

/**
 * Which rungs one resolution may use. A caller walking an explicit chain scopes
 * each link, so the chain's order is the only fallback and a link never lands
 * on a backend nobody named. Without a scope the full ordering applies, for
 * callers who just want auto() to find something. No scope reaches the
 * keyless tier: only an unscoped auto() does. 'running' is 'local' without
 * the launch rung, for a caller that must not start anything just by looking
 * (MOD-18).
 */
export function rungsFor(scope: Scope | undefined, remote = false): Rung[] {
  if (scope === 'keyed') return ['keyed']
  if (scope === 'local') return ['reachable', 'launched']
  if (scope === 'running') return ['reachable']
  return rungOrder(remote)
}

async function resolveOnce(
  prefer?: Prefer,
  remote = false,
  modelId?: string,
  scope?: Scope,
  provider?: string,
): Promise<Resolved> {
  // A provider or custom endpoint is its own scope (MOD-6): that server or nothing.
  if (provider) {
    const got = await remoteAttempt(provider, modelId)
    if ('failed' in got) throw new Error(`neorouter: ${got.failed}`)
    return got
  }
  const rejected: { id: string; why: string }[] = []
  // Debug escape hatch for exercising a rung that would otherwise never win.
  const only = process.env.NEOROUTER_ONLY_RUNG

  let reachable: Server[] = []

  const tryReachable = async (): Promise<Resolved | null> => {
    reachable = only && only !== 'reachable' ? [] : await reachableServers()
    if (reachable.length) anyServer = true
    const r1 = await fromServers(reachable, 'reachable', prefer, modelId)
    if (r1?.resolved) return r1.resolved
    if (r1) rejected.push(...r1.all.map((c) => ({ id: c.id, why: c.reject! })))
    return null
  }

  // Whether any local server was found or started, for saying why (MOD-21).
  let anyServer = false

  const tryLaunched = async (): Promise<Resolved | null> => {
    for (const l of only && only !== 'launched' ? [] : await launchable(reachable)) {
      const started = await launch(l, l.files[0])
      if (!started) continue
      anyServer = true
      const r2 = await fromServers([started.server], 'launched', prefer, modelId)
      if (r2?.resolved) return { ...r2.resolved, pid: started.pid, coldStartMs: started.coldStartMs }
    }
    return null
  }

  const hostedOnly = (fn: () => Promise<Resolved | null>) => async () => (only && only !== 'hosted' ? null : fn())

  const attempt = {
    reachable: tryReachable,
    launched: tryLaunched,
    keyed: hostedOnly(() => remoteResolution('openrouter', modelId, rejected)),
    keyless: hostedOnly(() => keylessResolution(rejected, modelId)),
  }
  for (const rung of rungsFor(scope, remote)) {
    const got = await attempt[rung]()
    if (got) return got
  }

  throw new Error(`neorouter: ${localFailure(scope, anyServer, rejected, modelId)}`)
}

/** Why a link could not be resolved, in words naming it (MOD-21). */
export interface Failed {
  failed: string
}

/** A short list says what is on offer; a catalogue is too long to read out. */
function offered(ids: string[]): string {
  if (!ids.length) return 'it lists no models'
  return ids.length <= 3 ? `it serves ${ids.join(', ')}` : `it lists ${ids.length} others`
}

/**
 * A provider or custom endpoint, scoped to that server (MOD-6): its pinned
 * model, or OpenRouter's roomiest free one (MOD-9), or why not (MOD-21).
 */
export async function remoteAttempt(
  name: string,
  modelId?: string,
  rejected: { id: string; why: string }[] = [],
): Promise<Resolved | Failed> {
  const server = await remoteServer(name)
  if (!server) {
    const provider = providerById(name)
    return { failed: provider ? `no key for ${provider.name}` : `no custom endpoint named ${name}` }
  }
  const label = providerById(name)?.name ?? name
  const listing = await fetchModels(server)
  if (!listing.ok)
    return {
      failed:
        listing.why === 'rejected'
          ? `${label} refused the key`
          : listing.message.startsWith('could not reach')
            ? `${label} could not be reached at ${server.baseURL}`
            : `${label}: ${listing.message}`,
    }
  const chosen = chooseListed(listing.models, modelId, { name, custom: server.custom })
  if (!chosen)
    return {
      failed: modelId
        ? `${label} does not serve ${modelId}; ${offered(listing.models.map((m) => m.id))}`
        : `${label} offers no free chat model`,
    }
  const { model, replaced } = chosen
  return {
    rung: 'hosted',
    backend: server.backend,
    baseURL: server.baseURL,
    modelId: model.id,
    // A custom endpoint at this computer's own address keeps prompts here (MOD-20).
    local: !!server.custom && onThisMachine(server.baseURL),
    contextWindow: model.contextWindow ?? 8192,
    reason: replaced
      ? `${replaced} is gone from ${name}; it serves only ${model.id} now`
      : modelId
        ? `pinned at ${name}`
        : 'no model named; the free OpenRouter model with the largest context',
    rejected,
    server,
    ...(replaced && { replaced }),
  }
}

/** remoteAttempt for a rung that falls through: null instead of why. */
export async function remoteResolution(
  name: string,
  modelId?: string,
  rejected: { id: string; why: string }[] = [],
): Promise<Resolved | null> {
  const got = await remoteAttempt(name, modelId, rejected)
  return 'failed' in got ? null : got
}

/** Why no local model answered (MOD-21). */
export function localFailure(
  scope: Scope | undefined,
  anyServer: boolean,
  rejected: { id: string; why: string }[],
  modelId?: string,
): string {
  if (scope !== 'local' && scope !== 'running')
    return 'nothing to talk to: no local server, no installed runtime, no network'
  if (!anyServer)
    return scope === 'running' ? 'no local model server is running' : 'no local model server is running or installed'
  if (modelId) {
    const found = rejected.find((r) => r.id === modelId)
    return found ? `${modelId} is ${found.why}` : `${modelId} is not installed on this computer`
  }
  const why = [...new Set(rejected.map((r) => r.why))]
  return why.length ? `no local model is usable (${why.join('; ')})` : 'no local model is installed'
}

async function keylessResolution(
  rejected: { id: string; why: string }[],
  modelId?: string,
): Promise<Resolved | null> {
  const [hosted] = await hostedServers()
  // A pinned id belongs to a named backend; the anonymous tier serves none.
  if (!hosted || modelId) return null
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

/**
 * The caller never picked this model, so they are told which one answered —
 * once, on stderr, where it cannot corrupt piped stdout.
 */
function announce(r: Resolved): void {
  if (process.env.NEOROUTER_QUIET) return
  const cold = r.coldStartMs ? `, ${(r.coldStartMs / 1000).toFixed(1)}s cold start` : ''
  const gone = r.replaced ? `; ${r.replaced} is gone` : ''
  const rung = r.rung === 'hosted' && r.local ? 'on this computer' : r.rung
  console.error(`neorouter: ${r.backend} · ${r.modelId} (${rung}${cold}${gone})`)
}

// Keyed by preference: 'fast' and the default resolve to different models, so a
// single memo would hand the second caller the first caller's backend.
const pending = new Map<string, Promise<Resolved>>()

/** Resolution is memoised per process; the first call pays for discovery. */
export function resolveBackend(
  prefer?: Prefer,
  remote = false,
  modelId?: string,
  scope?: Scope,
  provider?: string,
): Promise<Resolved> {
  const key = `${prefer ?? 'default'}:${remote}:${modelId ?? ''}:${scope ?? ''}:${provider ?? ''}`
  let p = pending.get(key)
  if (!p) {
    p = resolveOnce(prefer, remote, modelId, scope, provider).then((r) => {
      announce(r)
      return r
    })
    pending.set(key, p)
  }
  return p
}

/**
 * Resolution without the throw, for walking a fallback chain: a link that
 * cannot be satisfied yields null so the caller can try the next one.
 */
export async function probeBackend(
  prefer?: Prefer,
  remote = false,
  modelId?: string,
  scope?: Scope,
  provider?: string,
): Promise<Resolved | null> {
  return resolveBackend(prefer, remote, modelId, scope, provider).catch(() => null)
}

/**
 * Why a probe of the same arguments came back null, or null when it resolves
 * (MOD-21). Memoised with resolution, so it costs nothing after the probe.
 */
export async function diagnoseBackend(
  prefer?: Prefer,
  remote = false,
  modelId?: string,
  scope?: Scope,
  provider?: string,
): Promise<string | null> {
  return resolveBackend(prefer, remote, modelId, scope, provider).then(
    () => null,
    (e) => (e instanceof Error ? e.message : String(e)).replace(/^neorouter: /, ''),
  )
}

/**
 * Forgets every resolution, failures included, so the next probe looks again —
 * for a caller that has just changed what there is to find (a key saved, a
 * server started).
 */
export function reset(): void {
  pending.clear()
}
