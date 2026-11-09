/**
 * CLI-43: an answer asked from a shell, drawn in a dim gutter so it stands
 * apart from what commands printed. Words wrap inside the gutter; a fenced
 * code block is drawn indented without it, so its lines copy clean. On a
 * terminal with colour, markdown is drawn as it reads (CLI-44): **bold**,
 * `code`, *italic*, headings and bullets. Text arrives in pieces as it
 * streams; a word is held until it is whole, and a line's first characters
 * until it is known whether they open a fence, a heading or a bullet.
 */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const BAR = '│'
const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s*#{1,6}\s+/
const BULLET = /^(\s*)[-*+]\s+/
const ON = { bold: '\x1b[1m', code: '\x1b[36m', italic: '\x1b[3m' }
const OFF = { bold: '\x1b[22m', code: '\x1b[39m', italic: '\x1b[23m' }
type Style = keyof typeof ON
const edge = (c: string | undefined) => c === undefined || /[\s.,;:!?)(\]['"]/.test(c)

export interface Gutter {
  /** What to write for this piece of the answer. */
  text: (piece: string) => string
  /** What is still held, and the end of the last line. */
  end: () => string
  /** A note of navi's (a tool call, the model), in the gutter. */
  note: (s: string) => string
}

export function makeGutter(width: number, color = true): Gutter {
  const bar = color ? `${dim(BAR)} ` : `${BAR} `
  const room = Math.max(20, width)
  // start: holding a line's first characters; tail: the rest of a fence line, not drawn.
  let state: 'start' | 'tail' | 'prose' | 'code' = 'start'
  let held = ''
  let fence = false
  let col = 0
  let word = ''
  let space = ''
  let out = ''
  // Blank lines, drawn only once something follows them.
  let blank = 0
  // CLI-44: the styles open now, kept across words and wraps, never past a line.
  const open = new Set<Style>()
  const reopen = () => [...open].map((k) => ON[k]).join('')
  const toggle = (k: Style) => {
    if (open.has(k)) {
      open.delete(k)
      return OFF[k]
    }
    open.add(k)
    return ON[k]
  }
  /** A word as drawn, its markers turned to styles, and how wide it shows. */
  const styled = (w: string): [string, number] => {
    if (!color) return [w, [...w].length]
    const cs = [...w]
    let text = ''
    let n = 0
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]
      if (open.has('code')) {
        if (c === '`') text += toggle('code')
        else (text += c), n++
      } else if (c === '`') text += toggle('code')
      else if (c === '*' && cs[i + 1] === '*') {
        text += toggle('bold')
        i++
      } else if ((c === '*' || c === '_') && (open.has('italic') ? edge(cs[i + 1]) : edge(cs[i - 1]) && cs[i + 1] !== undefined && !edge(cs[i + 1]))) {
        text += toggle('italic')
      } else (text += c), n++
    }
    return [text, n]
  }
  const close = () => {
    if (open.size) out += '\x1b[0m'
    open.clear()
  }
  const blanks = () => {
    for (; blank > 0; blank--) out += `${color ? dim(BAR) : BAR}\n`
  }

  const flush = () => {
    if (!word) return
    const was = reopen()
    const [text, n] = styled(word)
    if (col === 0) {
      blanks()
      out += bar + was + space
      col = 2 + space.length
    } else if (col + space.length + n > room && col > 2) {
      out += `\n${bar}${was}`
      col = 2
    } else {
      out += space
      col += space.length
    }
    out += text
    col += n
    word = ''
    space = ''
  }
  const prose = (c: string) => {
    if (c === '\n') {
      flush()
      close()
      // A blank line keeps the gutter going.
      if (col === 0) blank++
      else out += '\n'
      col = 0
      space = ''
      state = 'start'
      held = ''
    } else if (c === ' ' || c === '\t') {
      flush()
      space += c === '\t' ? '    ' : ' '
    } else word += c
  }
  const code = (c: string) => {
    if (c === '\n') {
      out += '\n'
      col = 0
      state = 'start'
      held = ''
      return
    }
    if (col === 0) {
      out += '    '
      col = 4
    }
    out += c
    col++
  }
  const resolve = (ended: boolean) => {
    const line = held
    held = ''
    if (FENCE.test(line)) {
      // The fence is not drawn: a blank line before the code and after it.
      fence = !fence
      blank = 0
      out += '\n'
      col = 0
      state = ended ? 'start' : 'tail'
      return
    }
    state = fence ? 'code' : 'prose'
    const draw = fence ? code : prose
    let rest = line
    if (!fence && color) {
      // CLI-44: a heading in bold, a bullet as one.
      const heading = HEADING.exec(rest)
      const bullet = BULLET.exec(rest)
      if (heading) {
        rest = rest.slice(heading[0].length)
        open.add('bold')
      } else if (bullet) rest = `${bullet[1]}• ${rest.slice(bullet[0].length)}`
    }
    for (const c of rest) draw(c)
    if (ended) draw('\n')
  }
  const take = (c: string) => {
    if (state === 'tail') {
      if (c === '\n') state = 'start'
    } else if (state === 'prose') prose(c)
    else if (state === 'code') code(c)
    else if (c === '\n') resolve(true)
    else {
      held += c
      const shown = held.trimStart()
      // Hashes are held until it is clear how many there are.
      if (shown.length >= 3 && !(/^#+$/.test(shown) && shown.length < 7)) resolve(false)
    }
  }

  return {
    text(piece) {
      out = ''
      for (const c of piece) take(c)
      return out
    },
    end() {
      out = ''
      if (state === 'start' && held) resolve(false)
      flush()
      close()
      if (col > 0) out += '\n'
      // A code block the answer left open is closed.
      if (fence) out += '\n'
      fence = false
      blank = 0
      col = 0
      state = 'start'
      held = ''
      return out
    },
    note: (s) => `${bar}${color ? dim(s) : s}`,
  }
}

export interface Where {
  cwd: string
  home?: string
  /** The command whose output a file holds, when the shell kept it (CLI-42). */
  printedBy?: (path: string) => string | undefined
}

/** A path as the user would say it: from here, or from home. */
function shortPath(p: string, where: Where): string {
  const cwd = where.cwd.replace(/\/$/, '')
  if (p === cwd) return '.'
  if (p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1)
  const home = where.home?.replace(/\/$/, '')
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`
  return p
}

const cut = (s: string, n = 60) => {
  const one = s.replace(/\s*\n\s*/g, ' ↵ ')
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/**
 * CLI-44: a tool call in plain words for the gutter, `· read app.py` rather
 * than its input as JSON. A call it has no words for is undefined.
 */
export function describeCall(name: string, input: unknown, where: Where): string | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined)
  const path = str('path')
  const shown = path && shortPath(path, where)
  switch (name) {
    case 'read_file': {
      if (!path) return
      const from = typeof i.offset === 'number' ? i.offset : undefined
      const many = typeof i.limit === 'number' ? i.limit : undefined
      const lines = from || many ? `, lines ${from ?? 1}–${many ? (from ?? 1) + many - 1 : 'end'}` : ''
      const by = where.printedBy?.(path)
      return by ? `read what \`${cut(by, 50)}\` printed${lines}` : `read ${shown}${lines}`
    }
    case 'list_dir':
      return path && `list ${shown}`
    case 'write_file':
      return path && `write ${shown}`
    case 'edit_file':
      return path && `edit ${shown}`
    case 'grep':
      return str('pattern') && `search for "${cut(str('pattern')!, 40)}"${path ? ` in ${shown}` : ''}`
    case 'glob':
      return str('pattern') && `find ${cut(str('pattern')!, 40)}${path ? ` in ${shown}` : ''}`
    case 'run_shell':
      return str('command') && `run ${cut(str('command')!)}`
    case 'web_search':
      return str('query') && `search the web for "${cut(str('query')!, 50)}"`
    case 'fetch_url':
      return str('url') && `fetch ${cut(str('url')!)}`
    case 'browser_open':
      return str('url') && `open ${cut(str('url')!)} in the browser`
    case 'browser_read':
      return 'read the browser page'
    case 'remember':
      return 'remember a fact'
  }
}
