import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** Provider name -> the variable people already export for it. */
const ENV_FOR: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
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
