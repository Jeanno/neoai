/** A change to one file, as approval sees it (TL-38). */
export interface FileChange {
  /** As the model gave it, for showing. */
  path: string
  /** True when the file does not exist yet. */
  created: boolean
  /** Where it really lands, when a symbolic link takes it somewhere the path does not say. */
  lands?: string
  /** Changed lines marked `-` and `+`, with unchanged ones around them. */
  diff: string
  added: number
  removed: number
}

const CONTEXT = 3

/**
 * Control characters shown as symbols: written raw, an escape sequence in the
 * model's text could move the cursor and paint over the lines being approved.
 */
export function visible(line: string): string {
  return line.replace(UNSEEN, (c) => {
    const code = c.charCodeAt(0)
    if (code < 0x20) return String.fromCharCode(0x2400 + code)
    if (code === 0x7f) return '\u2421'
    // Bidi controls and zero-width characters would reorder or hide text unseen.
    return code > 0x9f ? `<U+${code.toString(16).toUpperCase()}>` : '\ufffd'
  })
}

/** Characters a terminal acts on or hides rather than shows (TL-38). */
const UNSEEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g

/** Whether text holds any character `visible` would have to stand in for. */
export const hasUnseen = (text: string) => new RegExp(UNSEEN.source).test(text.replace(/\t/g, ''))

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
  if (!gone.length && !come.length)
    return { diff: before === after ? '(no change)' : '(only the newline at the end of the file changes)', added: 0, removed: 0 }
  const from = Math.max(0, start - CONTEXT)
  const to = Math.min(a.length, a.length - end + CONTEXT)
  const out = [
    `@@ line ${start + 1} @@`,
    ...a.slice(from, start).map((l) => `  ${l}`),
    ...gone.map((l) => `- ${l}`),
    ...come.map((l) => `+ ${l}`),
    ...a.slice(a.length - end, to).map((l) => `  ${l}`),
  ]
  // Never cut: what is approved is all of what is shown.
  return { diff: out.map(visible).join('\n'), added: come.length, removed: gone.length }
}

export const GLANCE_LINES = 6
export const GLANCE_WIDTH = 60

/**
 * What a notification shows of a change (PSH-14): its changed lines only, the
 * first few, each cut short, and how many more there are. The diff is already
 * made visible, so nothing in it can hide.
 */
export function glance(change: Pick<FileChange, 'diff'>): string {
  const changed = change.diff.split('\n').filter((l) => l.startsWith('- ') || l.startsWith('+ '))
  const cut = (l: string) => (l.length > GLANCE_WIDTH ? `${l.slice(0, GLANCE_WIDTH - 1).trimEnd()}…` : l.trimEnd())
  const more = changed.length - GLANCE_LINES
  return [...changed.slice(0, GLANCE_LINES).map(cut), ...(more > 0 ? [`… ${more} more line${more === 1 ? '' : 's'}`] : [])].join('\n')
}

/** Where a browser action would happen, for a notification (PSH-15): host and path, cut short. */
export function glancePage(url: string): string {
  try {
    const u = new URL(url)
    const where = `${u.host}${u.pathname === '/' ? '' : u.pathname}`
    return visible(`on ${where.length > GLANCE_WIDTH ? `${where.slice(0, GLANCE_WIDTH - 1)}…` : where}`)
  } catch {
    return ''
  }
}

/** One line for a change: `edit src/a.ts (+2 -1)`, `create notes.md (+12)`. */
export function summarize(change: FileChange): string {
  const counts = change.created ? `+${change.added}` : `+${change.added} -${change.removed}`
  const lands = change.lands ? ` → ${change.lands}` : ''
  return visible(`${change.created ? 'create' : 'edit'} ${change.path}${lands} (${counts})`)
}
