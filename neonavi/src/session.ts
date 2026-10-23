import { readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { sessionsDir } from 'neorouter'

/**
 * One history per directory, so a question asked in one project never answers
 * with another project's context. The path is hashed rather than flattened —
 * directory names contain characters a filename cannot.
 */
export function sessionFile(cwd: string, home: string): string {
  const key = createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  return join(sessionsDir(home), `${key}.json`)
}

/** A history file's contents: today's shape, or a bare array from before (SES-12). */
function parse(text: string): { cwd?: string; messages: ModelMessage[] } {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return { messages: parsed }
    if (parsed && Array.isArray(parsed.messages))
      return { ...(typeof parsed.cwd === 'string' && { cwd: parsed.cwd }), messages: parsed.messages }
  } catch {}
  // Missing, half-written, or hand-edited: none of it is worth a crash.
  return { messages: [] }
}

export async function loadSession(file: string): Promise<ModelMessage[]> {
  return parse(await readFile(file, 'utf8').catch(() => '')).messages
}

/** Saves a directory's history; `cwd` is kept in it so a listing can name it (SES-12). */
export async function saveSession(file: string, messages: ModelMessage[], cwd?: string): Promise<void> {
  // 0700: these files hold whatever navi has read — file contents, shell
  // output — so they are nobody else's business on a shared machine.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, JSON.stringify(cwd ? { cwd, messages } : messages, null, 2), { mode: 0o600 })
}

export interface SavedSession {
  file: string
  /** Unknown for a file written before directories were kept (SES-12). */
  cwd?: string
  messages: number
  used: Date
}

/** Every saved history, most recently used first (SES-13). */
export async function listSessions(home: string): Promise<SavedSession[]> {
  const dir = sessionsDir(home)
  const names = (await readdir(dir).catch(() => [])).filter((n) => /^[0-9a-f]{16}\.json$/.test(n))
  const all = await Promise.all(
    names.map(async (name): Promise<SavedSession | null> => {
      const file = join(dir, name)
      // Another navi may clear it between the listing and this.
      const [text, info] = await Promise.all([readFile(file, 'utf8').catch(() => ''), stat(file).catch(() => null)])
      const { cwd, messages } = parse(text)
      return info && { file, ...(cwd && { cwd }), messages: messages.length, used: info.mtime }
    }),
  )
  return all.filter((s): s is SavedSession => !!s).sort((a, b) => b.used.getTime() - a.used.getTime())
}

/** Deletes one directory's history; false when it had none (SES-14). */
export async function clearSession(cwd: string, home: string): Promise<boolean> {
  const file = sessionFile(cwd, home)
  const had = await stat(file).then(() => true, () => false)
  await rm(file, { force: true })
  return had
}

/** Deletes every saved history and returns how many there were (SES-14). */
export async function clearAllSessions(home: string): Promise<number> {
  const all = await listSessions(home)
  await Promise.all(all.map((s) => rm(s.file, { force: true })))
  return all.length
}

/** How long ago, roughly: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(then: Date, now = new Date()): string {
  const min = Math.round((now.getTime() - then.getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / (24 * 60))} days ago`
}
