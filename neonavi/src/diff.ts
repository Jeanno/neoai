/** A change to one file, as approval sees it (TL-38). */
export interface FileChange {
  /** As the model gave it, for showing. */
  path: string
  /** True when the file does not exist yet. */
  created: boolean
  /** Changed lines marked `-` and `+`, with unchanged ones around them. */
  diff: string
  added: number
  removed: number
}

const CONTEXT = 3
/** More than this and the diff is cut: a whole new file need not scroll past. */
const SHOWN = 80

function lines(text: string): string[] {
  if (!text) return []
  const all = text.split('\n')
  // A final newline ends the last line rather than starting an empty one.
  return all.at(-1) === '' ? all.slice(0, -1) : all
}

/**
 * The lines between the common start and the common end, as one hunk (TL-38).
 * An edit_file change is exactly one such region; a whole-file rewrite shows
 * everything from its first change to its last, which over-reports a little
 * and never under-reports.
 */
export function diffLines(before: string, after: string): { diff: string; added: number; removed: number } {
  const a = lines(before)
  const b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const gone = a.slice(start, a.length - end)
  const come = b.slice(start, b.length - end)
  if (!gone.length && !come.length) return { diff: '(no change)', added: 0, removed: 0 }
  const from = Math.max(0, start - CONTEXT)
  const to = Math.min(a.length, a.length - end + CONTEXT)
  const out = [
    `@@ line ${start + 1} @@`,
    ...a.slice(from, start).map((l) => `  ${l}`),
    ...gone.map((l) => `- ${l}`),
    ...come.map((l) => `+ ${l}`),
    ...a.slice(a.length - end, to).map((l) => `  ${l}`),
  ]
  const shown = out.length > SHOWN ? [...out.slice(0, SHOWN), `…[${out.length - SHOWN} more lines]`] : out
  return { diff: shown.join('\n'), added: come.length, removed: gone.length }
}

/** One line for a change: `edit src/a.ts (+2 -1)`, `create notes.md (+12)`. */
export function summarize(change: FileChange): string {
  const counts = change.created ? `+${change.added}` : `+${change.added} -${change.removed}`
  return `${change.created ? 'create' : 'edit'} ${change.path} (${counts})`
}
