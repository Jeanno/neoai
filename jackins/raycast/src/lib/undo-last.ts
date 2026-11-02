import { readConfig } from 'neorouter'
import { recordUndone } from 'neonavi/ledger'
import { listUndo, redo, redoneLines, undo, undoneReport, type Turn } from 'neonavi/undo'

/**
 * Undo in Raycast (RAY-13): the extension works in one folder of its own
 * (RAY-1), so its turns' file changes are kept there, and the latest one
 * can be put back as `navi undo` does in a terminal.
 */

/** The latest kept turn, when it is the one that answered `question`; otherwise nothing to offer. */
export async function undoableFor(home: string, dir: string, question: string): Promise<Turn | undefined> {
  const [latest] = await listUndo(home, dir)
  return latest && latest.prompt === question.slice(0, 200) ? latest : undefined
}

/** Puts back the latest turn's changes: what happened, a line each, or nothing when there was none. */
export async function undoLast(home: string, dir: string): Promise<string[] | undefined> {
  const got = await undo(home, dir)
  if (!got) return undefined
  // LED-9: counted against the model that made them.
  if ((await readConfig()).ledger !== false) await recordUndone(home, got.turns, got.restored.length + got.removed.length > 0)
  return undoneReport(got).lines
}

/** Brings back what the last undo put back (UND-14): a line each, or nothing to redo. */
export async function redoLast(home: string, dir: string): Promise<string[] | undefined> {
  const got = await redo(home, dir)
  return got && redoneLines(got)
}
