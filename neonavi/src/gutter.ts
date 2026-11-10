/**
 * CLI-43: an answer asked from a shell, drawn in a dim gutter so it stands
 * apart from what commands printed. Words wrap inside the gutter; a fenced
 * code block is drawn indented without it, so its lines copy clean. On a
 * terminal with colour, markdown is drawn as it reads (CLI-44): **bold**,
 * `code`, *italic*, headings and bullets. Text arrives in pieces as it
 * streams; a word is held until it is whole, and a line's first characters
 * until it is known whether they open a fence, a heading or a bullet. A
 * table is held whole, then drawn in aligned columns (CLI-46).
 */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const BAR = '│'
const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s*#{1,6}\s+/
const BULLET = /^(\s*)[-*+]\s+/
const TABLE = /^\s*\|/
const RULE_CELL = /^:?-+:?$/
const ESC = /\x1b\[[0-9;]*m/g
/** Columns a character takes on a terminal: East Asian wide ones and emoji take two. */
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u
export const columns = (s: string) => [...s.replace(ESC, '')].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0)

/** A table row's cells, split on `|` outside code and not escaped. */
export function cells(row: string): string[] {
  const out: string[] = []
  let cell = ''
  let code = false
  const s = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') (cell += '|'), i++
    else if (c === '`') (code = !code), (cell += c)
    else if (c === '|' && !code) out.push(cell.trim()), (cell = '')
    else cell += c
  }
  out.push(cell.trim())
  return out
}
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
  let state: 'start' | 'tail' | 'prose' | 'code' | 'table' = 'start'
  // CLI-46: a table's rows, held until a line that is not one.
  let rows: string[] = []
  let row = ''
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
  /** A cell's markdown as drawn, in lines no wider than `room` columns. */
  const cellLines = (text: string, width: number): string[] => {
    const lines: string[] = []
    let line = ''
    let lineWidth = 0
    let was = ''
    const words = text.split(/ +/).filter(Boolean)
    for (const w of words) {
      const [t, _] = styled(w)
      const n = columns(t)
      if (line && lineWidth + 1 + n > width) {
        lines.push(was + line + (open.size ? '\x1b[0m' : ''))
        was = reopen()
        line = ''
        lineWidth = 0
      }
      line += (line ? ' ' : '') + t
      lineWidth += (lineWidth ? 1 : 0) + n
    }
    lines.push(was + line + (open.size ? '\x1b[0m' : ''))
    open.clear()
    return lines
  }
  const pad = (s: string, w: number, align: string) => {
    const gap = Math.max(0, w - columns(s))
    if (align === 'right') return ' '.repeat(gap) + s
    if (align === 'center') return ' '.repeat(gap >> 1) + s + ' '.repeat(gap - (gap >> 1))
    return s + ' '.repeat(gap)
  }
  /** CLI-46: the rows held, in columns that fit; or row by row, when no columns would. */
  const drawTable = () => {
    const parsed = rows.map(cells)
    rows = []
    const ruleAt = parsed.findIndex((r) => r.every((c) => RULE_CELL.test(c)))
    const aligns = ruleAt >= 0 ? parsed[ruleAt].map((c) => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left')) : []
    const body = parsed.filter((_, i) => i !== ruleAt)
    const head = ruleAt === 1 ? body[0] : undefined
    const n = Math.max(...body.map((r) => r.length))
    const raw = body.map((r) => Array.from({ length: n }, (_, j) => r[j] ?? ''))
    // The header, when there is one, is the first of them.
    const isHead = (i: number) => head !== undefined && i === 0
    const plain = (s: string) => (color ? columns(styled(s)[0]) : columns(s))
    const widths = Array.from({ length: n }, (_, j) => Math.max(1, ...raw.map((r) => plain(r[j]))))
    open.clear()
    const gaps = 2 * (n - 1)
    // The widest column gives way first, down to a word's worth.
    for (;;) {
      const total = 2 + widths.reduce((a, b) => a + b, 0) + gaps
      if (total <= room) break
      const j = widths.indexOf(Math.max(...widths))
      if (widths[j] <= 10) break
      widths[j]--
    }
    const fits = 2 + widths.reduce((a, b) => a + b, 0) + gaps <= room
    blanks()
    if (!fits || n < 2) {
      // Row by row: each cell on its own line, named by its header.
      raw.forEach((r, i) => {
        if (isHead(i)) return
        if (i > (head ? 1 : 0)) blank++
        r.forEach((c, j) => {
          if (!c) return
          // Bold by markdown, which only a gutter with colour draws.
          const name = head?.[j] && (color ? `**${head[j].replace(/\*\*/g, '')}:**` : `${head[j]}:`)
          for (const ch of name ? `${name} ${c}\n` : `${c}\n`) prose(ch)
        })
      })
      blanks()
      state = 'start'
      return
    }
    raw.forEach((r, i) => {
      const drawn = r.map((c, j) => {
        const lines = cellLines(c, widths[j])
        return isHead(i) && color ? lines.map((l) => `${ON.bold}${l}${OFF.bold}`) : lines
      })
      const tall = Math.max(...drawn.map((d) => d.length))
      for (let k = 0; k < tall; k++)
        out += `${bar}${drawn.map((d, j) => pad(d[k] ?? '', widths[j], aligns[j] ?? 'left')).join('  ').trimEnd()}\n`
      if (isHead(i)) out += `${bar}${(color ? dim : (s: string) => s)(widths.map((w) => '─'.repeat(w)).join('  '))}\n`
    })
    col = 0
  }
  const resolve = (ended: boolean) => {
    const line = held
    held = ''
    // CLI-46: a row joins the table held; anything else ends it.
    if (!fence && TABLE.test(line)) {
      state = 'table'
      row = line
      if (ended) {
        rows.push(row)
        row = ''
        state = 'start'
      }
      return
    }
    if (rows.length) drawTable()
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
    if (state === 'table') {
      if (c === '\n') {
        rows.push(row)
        row = ''
        state = 'start'
      } else row += c
    } else if (state === 'tail') {
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
      if (state === 'table') {
        rows.push(row)
        row = ''
        state = 'start'
      }
      if (rows.length) drawTable()
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
