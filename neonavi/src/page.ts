/**
 * A web page as text (BRW-5): Playwright's accessibility snapshot cut down to
 * what a model needs, and what an action changed in it (BRW-10). Nothing here
 * touches a browser, so all of it is tested on plain strings.
 */

/** Roles that only lay things out: left out unless they carry a name, their children moved up. */
const LAYOUT = new Set([
  'generic', 'rowgroup', 'row', 'cell', 'table', 'list', 'listitem', 'group', 'none', 'presentation',
  'paragraph', 'LineBreak', 'strong', 'emphasis', 'superscript', 'subscript', 'Section', 'time',
])

/** Roles a model can act on: the only lines that keep their ref. */
const ACTIONABLE = new Set([
  'link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem',
])

/** Lines whose whole role is landmark or heading: what a found line is said to sit under (BRW-7). */
const PLACE = /^(heading|banner|navigation|main|contentinfo|complementary|region|form|search|dialog|article)\b/

const MAX_PAGE = 8000
const MAX_FOUND = 50
const MAX_APPEARED = 40

/** One snapshot line taken apart: `role "name" [flag]...: text`. */
interface Node {
  role: string
  name?: string
  flags: string[]
  text?: string
}

const KEY = /^([\w-]+)(?: ("(?:[^"\\]|\\.)*"))?((?: \[[^\]]*\])*)$/

/**
 * Taken apart by its structure, so words on the page that look like a ref
 * or a name are never read as one. A key YAML had to quote comes in quotes.
 */
function parse(line: string): Node | null {
  let key: string
  let text: string | undefined
  const quoted = /^'((?:[^']|'')*)'(?::(?: (.*))?)?$/.exec(line)
  if (quoted) {
    key = quoted[1].replace(/''/g, "'")
    text = quoted[2]
  } else {
    // The key ends at the first ": " (or final ":") outside the quoted name.
    const m = /^([\w-]+(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*)(?::(?: (.*))?)?$/.exec(line)
    if (!m) return null
    key = m[1]
    text = m[2]
  }
  const k = KEY.exec(key)
  if (!k) return null
  const flags = k[3] ? k[3].slice(2, -1).split('] [') : []
  return { role: k[1], ...(k[2] && { name: k[2] }), flags, ...(text !== undefined && text !== '' && { text }) }
}

const show = (n: Node) => `${n.role}${n.name ? ` ${n.name}` : ''}${n.flags.map((f) => ` [${f}]`).join('')}${n.text ? `: ${n.text}` : ''}`

/**
 * The snapshot's lines kept (BRW-5), each indented by its depth among kept
 * lines. URLs are dropped: a link is followed by its ref.
 */
export function pageLines(snapshot: string): string[] {
  const out: string[] = []
  // Each open line's indentation in the snapshot, and its depth in the output.
  const open: { indent: number; depth: number }[] = []
  for (const raw of snapshot.split('\n')) {
    const m = /^(\s*)- (.*)$/.exec(raw)
    if (!m) continue
    const indent = m[1].length
    while (open.length && open.at(-1)!.indent >= indent) open.pop()
    const parent = open.length ? open.at(-1)!.depth : -1
    const node = parse(m[2])
    // An unnamed wrapper, a URL, an unnamed image, or text with no word in it.
    const skip =
      !node ||
      (LAYOUT.has(node.role) && !node.name && !node.text) ||
      (node.role === 'img' && !node.name) ||
      (node.role === 'text' && !/[\p{L}\p{N}]/u.test(node.text ?? ''))
    if (skip) {
      open.push({ indent, depth: parent })
      continue
    }
    const clickable = node.flags.includes('cursor=pointer')
    const keepRef = ACTIONABLE.has(node.role) || (clickable && !!(node.name || node.text))
    const kept: Node = {
      ...node,
      // A wrapper kept for its own words reads as the words.
      role: LAYOUT.has(node.role) && !node.name ? 'text' : node.role,
      // Where the pointer and focus are is not what the page says.
      flags: node.flags.filter((f) => f !== 'cursor=pointer' && f !== 'active' && (keepRef || !f.startsWith('ref='))),
    }
    const depth = parent + 1
    open.push({ indent, depth })
    out.push(`${'  '.repeat(depth)}${show(kept)}`)
  }
  return out
}

/**
 * A page that could not be read as elements, as its plain text (BRW-5): one
 * text line per line of words, under a note that there are no refs.
 */
export function textLines(text: string): string[] {
  const words = text.split('\n').map((l) => l.trim()).filter((l) => /[\p{L}\p{N}]/u.test(l))
  return ['(this page is too complex to read as elements in time; its text follows, without refs to act on)', ...words.map((l) => `text: ${l}`)]
}

/** Lines from `offset` (1-based) cut on a line boundary at the size limit, with how to go on (BRW-5). */
export function window(lines: string[], offset = 1): string {
  const start = Math.max(1, Math.floor(offset))
  if (!lines.length) return '(the page has no text)'
  if (start > lines.length) return `(the page has ${lines.length} lines; offset ${start} is past the end)`
  const kept: string[] = []
  let size = 0
  for (const l of lines.slice(start - 1)) {
    if (size + l.length > MAX_PAGE && kept.length) break
    kept.push(l)
    size += l.length + 1
  }
  const end = start + kept.length - 1
  const body = kept.join('\n')
  return end < lines.length ? `${body}\n…[${lines.length - end} more lines; read again with offset ${end + 1}]` : body
}

/** The lines holding `text`, numbered, each with the heading or landmark above it (BRW-7). */
export function find(lines: string[], text: string): string {
  const needle = text.toLowerCase()
  const hits: string[] = []
  let count = 0
  for (const [i, line] of lines.entries()) {
    if (!line.toLowerCase().includes(needle)) continue
    count++
    if (hits.length >= MAX_FOUND) continue
    const depth = indentOf(line)
    let under = ''
    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j].trim()
      if (PLACE.test(l) && (l.startsWith('heading') || indentOf(lines[j]) < depth)) {
        under = ` (under ${l})`
        break
      }
    }
    hits.push(`${i + 1}: ${line.trim()}${under}`)
  }
  if (!count) return `nothing on the page holds "${text}"`
  return count > MAX_FOUND ? `${hits.join('\n')}\n…[${count - MAX_FOUND} more lines hold it]` : hits.join('\n')
}

const indentOf = (line: string) => line.length - line.trimStart().length

/** A page as browser_open answers it (BRW-6). */
export function pageAnswer(title: string, url: string, lines: string[]): string {
  return `${title || '(no title)'}\n${url}\n\n${window(lines)}`
}

/**
 * What an action changed on one page (BRW-10): the lines that appeared, in
 * page order, and how many went. Compared without indentation, as a list's
 * new item moves nothing else.
 */
export function changes(before: string[], after: string[]): string {
  const left = new Map<string, number>()
  for (const l of before) left.set(l.trim(), (left.get(l.trim()) ?? 0) + 1)
  const appeared: string[] = []
  for (const l of after) {
    const n = left.get(l.trim()) ?? 0
    if (n) left.set(l.trim(), n - 1)
    else appeared.push(l.trim())
  }
  const gone = [...left.values()].reduce((a, b) => a + b, 0)
  if (!appeared.length && !gone) return 'nothing on the page changed'
  const shown = appeared.slice(0, MAX_APPEARED).map((l) => `+ ${l}`)
  if (appeared.length > MAX_APPEARED) shown.push(`…[${appeared.length - MAX_APPEARED} more appeared; read the page to see them]`)
  return [
    ...(appeared.length ? ['appeared on the page:', ...shown] : ['nothing appeared']),
    ...(gone ? [`${gone} line${gone === 1 ? '' : 's'} went from the page`] : []),
  ].join('\n')
}

/** The element a ref names, as a model and the user read it: `button "Place order"`; null when the page has none. */
export function element(lines: string[], ref: string): string | null {
  for (const line of lines) {
    const node = parse(line.trim())
    if (!node?.flags.includes(`ref=${ref}`)) continue
    // The role and name, without flags or what a field holds; its words when it has no name.
    return node.name ? `${node.role} ${node.name}` : `${node.role}${node.text ? ` ${node.text}` : ''}`
  }
  return null
}

/** Something to do on a page (BRW-9). */
export type Action =
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; submit?: boolean }
  | { kind: 'select'; ref: string; option: string }
  | { kind: 'press'; key: string }

/**
 * The element that has focus, from the raw snapshot: the deepest line marked
 * active, where a key press lands (BRW-11). Null when it is only the page.
 */
export function focused(snapshot: string): string | null {
  let found: string | null = null
  for (const raw of snapshot.split('\n')) {
    const m = /^\s*- (.*)$/.exec(raw)
    const node = m && parse(m[1])
    if (!node?.flags.includes('active')) continue
    found = node.name ? `${node.role} ${node.name}` : LAYOUT.has(node.role) && !node.text ? null : `${node.role}${node.text ? ` ${node.text}` : ''}`
  }
  return found
}

/** Where an action lands beyond its element (BRW-11). */
export interface Where {
  /** The page's host. */
  host: string
  /** The element with focus, for a key press. */
  focus?: string | null
  /** The host of the frame holding the element, when it is not the page's. */
  frame?: string
  /** For a link, the host it goes to, when it is not the page's. */
  goes?: string
}

/** One line the judge and the user read (BRW-11); null when the ref is gone. */
export function describeAction(action: Action, lines: string[], where: Where): string | null {
  const on = where.frame
    ? ` on ${where.frame} (in a frame on ${where.host || 'this page'})`
    : where.host
      ? ` on ${where.host}`
      : ''
  if (action.kind === 'press') return `press ${action.key}${where.focus ? ` in ${where.focus}` : ''}${on}`
  const what = element(lines, action.ref)
  if (!what) return null
  if (action.kind === 'click') return `click ${what}${where.goes ? ` (goes to ${where.goes})` : ''}${on}`
  if (action.kind === 'select') return `choose ${JSON.stringify(action.option)} in ${what}${on}`
  return `type ${JSON.stringify(action.text)} into ${what}${on}${action.submit ? ', then press Enter' : ''}`
}
