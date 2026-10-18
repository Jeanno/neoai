export interface Entry {
  where: 'remote' | 'local' | 'free'
  /** Exact model id, when one was named instead of an alias. */
  id?: string
  /** Which local model to prefer when none was named. */
  prefer?: 'fast'
}

/** Your machine is the reliable floor, so it goes last. */
const DEFAULT: Entry[] = [{ where: 'remote' }, { where: 'local', prefer: 'fast' }]

/** A fallback should answer quickly, so bare 'local' is the quick model. */
const ALIASES: Record<string, Entry> = {
  remote: { where: 'remote' },
  local: { where: 'local', prefer: 'fast' },
  fast: { where: 'local', prefer: 'fast' },
  best: { where: 'local' },
  // Keyless and public: only ever there because someone named it (MOD-13).
  free: { where: 'free' },
}

/**
 * One field holds either an alias, an exact model id, or an ordered list of
 * them — the list *is* the fallback chain, which is how OpenRouter models the
 * same problem. An id containing a slash is a hosted model; anything else names
 * a local one.
 */
export function parseModelSpec(value: string | string[] | undefined): Entry[] {
  if (value === undefined) return DEFAULT
  const parts = (Array.isArray(value) ? value : value.split(','))
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return DEFAULT
  return parts.map((p) => {
    if (ALIASES[p]) return ALIASES[p]
    // LM Studio names models like `qwen/qwen3-4b`; the prefix keeps them local.
    if (p.startsWith('local:')) return { where: 'local', id: p.slice('local:'.length) }
    return p.includes('/') ? { where: 'remote', id: p } : { where: 'local', id: p }
  })
}

import { probeBackend, type Scope } from 'neorouter'

export interface Chosen {
  entry: Entry
  options: { prefer?: 'fast'; think: boolean; remote: boolean; model?: string; scope: Scope }
  /** What the resolved backend can hold, in tokens. */
  contextWindow: number
}

/**
 * Walks the chain and returns the first link that actually resolves. A link
 * fails when its key is missing, its network is down, or its pinned model is
 * not installed — and then the next one is tried, which is what makes the list
 * a fallback chain rather than a preference.
 */
export async function resolveChain(chain: Entry[]): Promise<Chosen | null> {
  for (const entry of chain) {
    const remote = entry.where !== 'local'
    // Scoped: this link resolves the backend it names or none at all. Without
    // that, a mistyped remote id fell through to the anonymous tier instead of
    // failing so the next link could be tried.
    const scope: Scope = entry.where === 'remote' ? 'keyed' : entry.where === 'free' ? 'keyless' : 'local'
    const got = await probeBackend(entry.prefer, remote, entry.id, scope)
    if (got)
      return {
        entry,
        options: { prefer: entry.prefer, think: false, remote, model: entry.id, scope },
        contextWindow: got.contextWindow,
      }
  }
  return null
}
