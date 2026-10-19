import { probe, providerById, type AutoOptions } from 'neorouter'

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
  options: Pick<AutoOptions, 'prefer' | 'model' | 'scope' | 'provider'> & { think: boolean }
  /** What the resolved backend can hold, in tokens. */
  contextWindow: number
  backend: string
  modelId: string
  /** False when prompts leave the machine. */
  local: boolean
}

/** What auto() is given for one link: scoped to the backend it names (MOD-6). */
export function optionsFor(entry: Entry): Chosen['options'] {
  // navi asks local reasoning models not to think (MOD-11).
  if (entry.where === 'local') return { prefer: entry.prefer, think: false, model: entry.id, scope: 'local' }
  return { think: false, model: entry.id, provider: entry.provider }
}

/**
 * Walks the chain and returns the first link that actually resolves (MOD-5).
 * A link fails when its key is missing, its server is unreachable, or its
 * model is not on offer — and then the next one is tried, which is what makes
 * the list a fallback chain rather than a preference. `launch: false` starts
 * no local runtime (MOD-18).
 */
export async function resolveChain(chain: Entry[], { launch = true }: { launch?: boolean } = {}): Promise<Chosen | null> {
  for (const [index, entry] of chain.entries()) {
    const options = optionsFor(entry)
    // Without launching, a local link looks only at running servers (MOD-18).
    // The options handed back stay the link's own, so the model built from
    // them may still launch when it is used.
    const got = await probe(!launch && options.scope === 'local' ? { ...options, scope: 'running' } : options)
    if (got)
      return {
        entry,
        index,
        options,
        contextWindow: got.contextWindow,
        backend: got.backend,
        modelId: got.modelId,
        local: got.local,
      }
  }
  return null
}
