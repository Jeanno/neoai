/**
 * CLI-43: an answer asked from a shell, drawn in a dim gutter so it stands
 * apart from what commands printed. Words wrap inside the gutter; a fenced
 * code block is drawn indented without it, so its lines copy clean. Text
 * arrives in pieces as it streams; a word is held until it is whole, and a
 * line's first characters until it is known whether they open a fence.
 */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const BAR = '│'
const FENCE = /^\s*(```|~~~)/

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
  const blanks = () => {
    for (; blank > 0; blank--) out += `${color ? dim(BAR) : BAR}\n`
  }

  const flush = () => {
    if (!word) return
    const n = [...word].length
    if (col === 0) {
      blanks()
      out += bar + space
      col = 2 + space.length
    } else if (col + space.length + n > room && col > 2) {
      out += `\n${bar}`
      col = 2
    } else {
      out += space
      col += space.length
    }
    out += word
    col += n
    word = ''
    space = ''
  }
  const prose = (c: string) => {
    if (c === '\n') {
      flush()
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
    for (const c of line) draw(c)
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
      if (held.trimStart().length >= 3) resolve(false)
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
