import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

/** Putting back the files navi's last turn changed (undo.md). */

export const KEPT_TURNS = 10
export const MAX_KEPT = 1_000_000

/** A file as navi changed it: what it held (null: it did not exist) and what navi wrote; neither when too big (UND-3). */
export type Change = { path: string; before: string | null; after: string } | { path: string; big: true }

export interface Turn {
  /** Its own, as two turns can start in the same millisecond. */
  id?: string
  at: string
  prompt: string
  changes: Change[]
  /** Shell commands the turn ran (UND-6). */
  commands: string[]
  /** The job that ran it (UND-10). */
  job?: string
  /** The model that answered it, for the ledger (LED-9). */
  model?: string
}

interface Kept {
  cwd: string
  turns: Turn[]
  /** What the next turn is told was undone (UND-7). */
  note?: string
  /** What each undo took back, latest last, for redo (UND-14). */
  undone?: Turn[][]
}

/** Keyed as a session is (SES-1). */
export const undoFile = (home: string, cwd: string) =>
  join(home, '.neoai', 'undo', `${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}.json`)

async function load(home: string, cwd: string): Promise<Kept> {
  try {
    const got = JSON.parse(await readFile(undoFile(home, cwd), 'utf8'))
    if (Array.isArray(got?.turns))
      return { cwd, turns: got.turns, ...(typeof got.note === 'string' && { note: got.note }), ...(Array.isArray(got.undone) && { undone: got.undone }) }
  } catch {
    // None yet, or cut short: nothing to undo.
  }
  return { cwd, turns: [] }
}

async function store(home: string, kept: Kept) {
  const file = undoFile(home, kept.cwd)
  await mkdir(join(home, '.neoai', 'undo'), { recursive: true, mode: 0o700 })
  await writeFile(`${file}.tmp`, JSON.stringify(kept), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
  await chmod(file, 0o600)
}

export interface Recorder {
  wrote(path: string, before: string | null, after: string): void
  ran(command: string): void
  /** The model that answered the turn, once it is known (LED-9). */
  answeredBy(model: string): void
  /** Resolves once everything recorded is on disk. */
  saved(): Promise<void>
}

/** Records one turn's changes as they are made (UND-1, UND-2); a turn that changes no file is not kept. */
export function makeRecorder(home: string, cwd: string, prompt: string, now = () => new Date(), job?: string): Recorder {
  const turn: Turn = { id: randomBytes(6).toString('hex'), at: now().toISOString(), prompt: prompt.slice(0, 200), changes: [], commands: [], ...(job && { job }) }
  let writes = Promise.resolve()
  const save = () => {
    if (!turn.changes.length) return
    writes = writes.then(async () => {
      try {
        const kept = await load(home, cwd)
        kept.turns = [...kept.turns.filter((t) => t.id !== turn.id), structuredClone(turn)].slice(-KEPT_TURNS)
        // UND-15: a new change ends what could be redone.
        delete kept.undone
        await store(home, kept)
      } catch {
        // Unrecorded is not worth failing the turn over.
      }
    })
  }
  return {
    wrote(path, before, after) {
      const big = (before?.length ?? 0) > MAX_KEPT || after.length > MAX_KEPT
      turn.changes.push(big ? { path, big: true } : { path, before, after })
      save()
    },
    ran(command) {
      turn.commands.push(command)
      save()
    },
    answeredBy(model) {
      turn.model = model
      save()
    },
    saved: () => writes,
  }
}

export interface Undone {
  /** The turns undone, newest first. */
  turns: Turn[]
  /** Put back as it was. */
  restored: string[]
  /** Created by the turn, so removed. */
  removed: string[]
  /** Changed since; left as it is (UND-5). */
  left: string[]
  /** Too big to have been kept (UND-3). */
  big: string[]
}

/**
 * How to name a recorded path for the user: relative to the working directory,
 * which may itself be reached through a link (`/var` is `/private/var`).
 */
export async function namer(cwd: string): Promise<(path: string) => string> {
  const real = await realpath(cwd).catch(() => cwd)
  return (path) => {
    for (const base of [real, cwd]) {
      const rel = relative(base, path)
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel
    }
    return path
  }
}

/**
 * Undoes the latest kept turn (UND-4), or with `job` every kept turn of that
 * job (UND-11); nothing when there is none. Paths are relative to `cwd`.
 */
export async function undo(home: string, cwd: string, job?: string): Promise<Undone | undefined> {
  const kept = await load(home, cwd)
  const turns = job ? kept.turns.filter((t) => t.job === job).reverse() : kept.turns.slice(-1)
  if (!turns.length) return
  kept.turns = kept.turns.filter((t) => !turns.includes(t))
  const out: Undone = { turns, restored: [], removed: [], left: [], big: [] }
  const name = await namer(cwd)
  for (const c of turns.flatMap((t) => [...t.changes].reverse())) {
    if ('big' in c) {
      out.big.push(name(c.path))
      continue
    }
    const now = await readFile(c.path, 'utf8').catch(() => null)
    if (now !== c.after) {
      out.left.push(name(c.path))
      continue
    }
    if (c.before === null) {
      await rm(c.path)
      out.removed.push(name(c.path))
    } else {
      await writeFile(c.path, c.before)
      out.restored.push(name(c.path))
    }
  }
  // A file changed twice is put back twice: named once, as it ends up.
  for (const k of ['restored', 'removed', 'left', 'big'] as const) out[k] = [...new Set(out[k])]
  out.restored = out.restored.filter((p) => !out.removed.includes(p))
  out.left = out.left.filter((p) => !out.restored.includes(p) && !out.removed.includes(p))
  const back = [...out.restored, ...out.removed]
  // UND-14: redo can bring back what was put back.
  if (back.length) kept.undone = [...(kept.undone ?? []), turns].slice(-KEPT_TURNS)
  if (back.length) {
    const said = `(navi: the user undid your file changes from the turn that began "${turns.at(-1)!.prompt}"${turns.length > 1 ? ' and the ones after it' : ''}: ${back.join(', ')} ${back.length === 1 ? 'is' : 'are'} back as before. Read a file again before changing it.)`
    kept.note = kept.note ? `${kept.note}\n${said}` : said
  }
  await store(home, kept)
  return out
}

export interface Redone {
  /** The turns redone, oldest first. */
  turns: Turn[]
  /** Holding what navi wrote again. */
  redone: string[]
  /** Changed since the undo; left as it is (UND-14). */
  left: string[]
}

/**
 * Redoes what the latest undo here took back (UND-14): each change, oldest
 * first, written again where the file still holds what the undo put back;
 * nothing when there is nothing to redo. The turns become undoable again.
 */
export async function redo(home: string, cwd: string): Promise<Redone | undefined> {
  const kept = await load(home, cwd)
  const turns = kept.undone?.pop()?.slice().reverse()
  if (!turns?.length) return
  const out: Redone = { turns, redone: [], left: [] }
  const name = await namer(cwd)
  for (const c of turns.flatMap((t) => t.changes)) {
    if ('big' in c) continue
    const now = await readFile(c.path, 'utf8').catch(() => null)
    if (now === c.after) continue
    if (now !== c.before) {
      out.left.push(name(c.path))
      continue
    }
    await mkdir(dirname(c.path), { recursive: true })
    await writeFile(c.path, c.after)
    out.redone.push(name(c.path))
  }
  out.redone = [...new Set(out.redone)]
  out.left = [...new Set(out.left)].filter((p) => !out.redone.includes(p))
  kept.turns = [...kept.turns, ...turns].sort((a, b) => a.at.localeCompare(b.at)).slice(-KEPT_TURNS)
  if (!kept.undone?.length) delete kept.undone
  if (out.redone.length) {
    const said = `(navi: the user redid your file changes from the turn that began "${turns[0].prompt}"${turns.length > 1 ? ' and the ones after it' : ''}, after undoing them: ${out.redone.join(', ')} ${out.redone.length === 1 ? 'holds' : 'hold'} what you wrote again${out.left.length ? `; ${out.left.join(', ')} changed since, so ${out.left.length === 1 ? 'it was' : 'they were'} left as the user has ${out.left.length === 1 ? 'it' : 'them'}` : ''}. Read a file again before changing it.)`
    kept.note = kept.note ? `${kept.note}\n${said}` : said
  }
  await store(home, kept)
  return out
}

/** What a redo did, a line each (UND-14). */
export function redoneLines(r: Redone): string[] {
  return [
    ...r.redone.map((p) => `redid ${p}`),
    ...r.left.map((p) => `left ${p}: it changed since the undo`),
    ...r.turns.flatMap((t) => t.commands).map((c) => `not run again: $ ${c}`),
  ]
}

/** What an undo did, a line each (UND-5, UND-6): for the terminal, a job's log and the phone. */
export function undoneLines(u: Pick<Undone, 'restored' | 'removed' | 'left' | 'big'> & { commands: string[] }): string[] {
  return [
    ...u.restored.map((p) => `put back ${p}`),
    ...u.removed.map((p) => `removed ${p} (navi made it)`),
    ...u.left.map((p) => `left ${p}: it changed since navi wrote it`),
    ...u.big.map((p) => `left ${p}: too big to have been kept`),
    ...u.commands.map((c) => `not undone, what this did: $ ${c}`),
  ]
}

/** An undo as the jobs API answers it (UND-11): names, never the contents kept. */
export const undoneReport = (u: Undone) => {
  const report = { restored: u.restored, removed: u.removed, left: u.left, big: u.big, commands: u.turns.flatMap((t) => t.commands) }
  return { ...report, lines: undoneLines(report) }
}

/** The files a job's kept turns changed (UND-10). */
export async function jobChanges(home: string, cwd: string, job: string): Promise<string[]> {
  const name = await namer(cwd)
  return [...new Set((await load(home, cwd)).turns.filter((t) => t.job === job).flatMap((t) => t.changes.map((c) => name(c.path))))]
}

/** The kept turns, newest first (UND-8). */
export async function listUndo(home: string, cwd: string): Promise<Turn[]> {
  return (await load(home, cwd)).turns.reverse()
}

/** What the next turn is to be told was undone, once (UND-7). */
export async function takeNote(home: string, cwd: string): Promise<string | undefined> {
  const kept = await load(home, cwd)
  if (!kept.note) return
  const { note } = kept
  delete kept.note
  await store(home, kept).catch(() => {})
  return note
}
