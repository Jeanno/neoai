import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { sessionsDir } from 'neorouter'

/** Turns to carry forward. Enough to follow up, short of filling the context. */
export const KEEP_TURNS = 20

/**
 * One history per directory, so a question asked in one project never answers
 * with another project's context. The path is hashed rather than flattened —
 * directory names contain characters a filename cannot.
 */
export function sessionFile(cwd: string, home: string): string {
  const key = createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  return join(sessionsDir(home), `${key}.json`)
}

export async function loadSession(file: string): Promise<ModelMessage[]> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Missing, half-written, or hand-edited: none of it is worth a crash.
    return []
  }
}

export async function saveSession(file: string, messages: ModelMessage[]): Promise<void> {
  // 0700: these files hold whatever navi has read — file contents, shell
  // output — so they are nobody else's business on a shared machine.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, JSON.stringify(messages, null, 2), { mode: 0o600 })
}

export function trim(messages: ModelMessage[], keep = KEEP_TURNS): ModelMessage[] {
  return messages.length <= keep ? messages : messages.slice(-keep)
}
