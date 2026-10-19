import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS } from './providers.ts'

export const APP = '.neoai'

/**
 * One directory for everything, as ~/.claude and ~/.codex do. Session history is
 * the part you are most likely to want to open or delete by hand, and an XDG
 * split would file it somewhere you would never think to look.
 */
export function configDir(home = homedir()) {
  return join(home, APP)
}

export function sessionsDir(home = homedir()) {
  return join(configDir(home), 'sessions')
}

/** Provider id -> the variable people already export for it (MOD-10). */
const ENV_FOR: Record<string, string> = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.env]))

export function envFor(provider: string): string | undefined {
  return ENV_FOR[provider]
}

/**
 * Environment first, file second. A key exported for one shell should not be
 * silently overridden by something written to disk weeks ago.
 */
export async function readKey(
  provider: string,
  dir = configDir(),
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const fromEnv = ENV_FOR[provider] && env[ENV_FOR[provider]]
  if (fromEnv) return fromEnv
  try {
    // { "keys": { "openrouter": "sk-or-..." } } — namespaced so a second
    // provider does not turn into a second top-level key-shaped field.
    const parsed = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
    return parsed?.keys?.[provider] ?? null
  } catch {
    // Absent or malformed: neither is worth failing a run that may not need it.
    return null
  }
}

/** The whole config object, or an empty one. Never throws. */
export async function readConfig(dir = configDir()): Promise<Record<string, any>> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** A custom OpenAI-compatible endpoint, as saved under `custom.<name>` (MOD-15). */
export interface Custom {
  baseURL: string
  key?: string
}

/** The well-formed custom endpoints in a config object, by name. */
export function customEndpoints(config: Record<string, any>): Record<string, Custom> {
  const out: Record<string, Custom> = {}
  const all = config?.custom
  if (!all || typeof all !== 'object') return out
  for (const [name, c] of Object.entries<any>(all)) {
    if (typeof c?.baseURL !== 'string' || !c.baseURL) continue
    out[name] = { baseURL: c.baseURL.replace(/\/+$/, ''), ...(typeof c.key === 'string' && c.key && { key: c.key }) }
  }
  return out
}
