import type { Writable } from 'node:stream'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

export interface Spinner {
  start: () => void
  /** Erases the spinner. Safe to call when not running. */
  stop: () => void
}

/**
 * Only on a terminal: a pipe would keep every frame, and a log would fill with
 * braille. Whoever writes to the terminal next must stop() first — the frame
 * sits on the current line and anything printed after it lands beside it.
 */
export function makeSpinner(output: Writable & { isTTY?: boolean }): Spinner {
  let timer: NodeJS.Timeout | null = null
  let i = 0
  if (!output.isTTY) return { start() {}, stop() {} }
  return {
    start() {
      if (timer) return
      const draw = () => output.write(`\r${dim(FRAMES[i++ % FRAMES.length])}`)
      draw()
      timer = setInterval(draw, INTERVAL_MS)
      timer.unref()
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
      output.write('\r\x1b[K')
    },
  }
}
