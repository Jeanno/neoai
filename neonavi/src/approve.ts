import { createInterface, type Interface } from 'node:readline/promises'
import { Writable, type Readable } from 'node:stream'
import { visible, type FileChange } from './diff.ts'
import { PROMPTS_KEPT } from './session.ts'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`

/** A diff for a terminal: removed lines red, added green, the rest dim. */
export function colorDiff(diff: string): string {
  return diff
    .split('\n')
    .map((l) => (l.startsWith('- ') ? red(l) : l.startsWith('+ ') ? green(l) : dim(l)))
    .join('\n')
}

/** One readline shared by everything that reads stdin: prompts and approvals alike. */
export interface Line {
  /**
   * The line typed, or null when input is gone (EOF, ^C, ^D). A secret answer
   * is not echoed as it is typed.
   */
  /** `remember` keeps an answer it approves for up-arrow recall (CLI-27); nothing else is kept. */
  ask: (
    prompt: string,
    opts?: { secret?: boolean; signal?: AbortSignal; remember?: (line: string) => boolean },
  ) => Promise<string | null>
  /** Starts reading now, so ^C reaches `onInterrupt` before the first question (CLI-25). */
  listen: () => void
  close: () => void
}

export interface Approver {
  /** `[y/N/a]`, or `[y/N]` for a command that could never be allowed (TL-43). */
  approve: (command: string, signal?: AbortSignal) => Promise<Answer>
  /** Shows the diff, then asks about the change by its summary (TL-38). */
  approveChange: (summary: string, change: FileChange, signal?: AbortSignal) => Promise<boolean>
  close: () => void
}

/** What a terminal sends around a paste when bracketed paste is on (CLI-26). */
const PASTE_ON = '\x1b[?2004h'
const PASTE_OFF = '\x1b[?2004l'

export function makeLine({
  input,
  output,
  onInterrupt,
  history,
}: {
  input: Readable
  output: Writable
  /** Earlier prompts, newest first, and where to keep them when one is added (CLI-27). */
  history?: { prompts: string[]; save: (prompts: string[]) => void }
  /** ^C on an empty line: true when it was handled (a turn stopped), false to leave (CLI-7, CLI-25). */
  onInterrupt?: () => boolean
}): Line {
  // Built on first use, not at construction: a readline interface starts
  // draining its input immediately, and the CLI does not ask until the model's
  // first tool call seconds later — by which time piped input is long gone.
  let rl: Interface | null = null
  let closed = false
  // Lines arrive whenever the stream delivers them, not when we ask — a pipe
  // hands over the answer and the next question in one chunk. Queue them so
  // nothing typed ahead is lost.
  const lines: string[] = []
  const waiting: ((line: string | null) => void)[] = []
  // A paste's lines, held until the Enter that sends them (CLI-26).
  let pasting = false
  let pasted: string[] = []
  const terminal = (input as { isTTY?: boolean }).isTTY === true && (output as { isTTY?: boolean }).isTTY === true
  const recalled = () => (rl as unknown as { history: string[] }).history
  const forget = (l: string) => {
    if (recalled()[0] === l) recalled().shift()
  }
  const remember = (l: string) => {
    if (!history || !l.trim() || l.startsWith(' ')) return
    const kept = [l, ...recalled().filter((p) => p !== l)].slice(0, PROMPTS_KEPT)
    recalled().splice(0, Infinity, ...kept)
    history.save(kept)
  }
  const deliver = (l: string) => (waiting.length ? waiting.shift()!(l) : lines.push(l))
  // What readline draws reaches the terminal only while a question is open:
  // keys typed during an answer would otherwise land in the middle of it, and
  // a key being typed must not show at all. Typed-ahead text shows with the
  // next prompt.
  let shows: 'all' | 'newline' | 'nothing' = 'nothing'
  const screen = new Writable({
    // Decided as each write is made and finished at once, never later, when
    // the question may have closed.
    write(chunk, _enc, done) {
      if (shows === 'all') output.write(chunk)
      else if (shows === 'newline' && String(chunk).includes('\n')) output.write('\n')
      done()
    },
  })
  Object.defineProperty(screen, 'columns', { get: () => (output as { columns?: number }).columns })
  output.on('resize', () => screen.emit('resize'))
  const open = () => {
    if (!rl) {
      rl = createInterface({
        input,
        output: screen,
        terminal: (output as { isTTY?: boolean }).isTTY === true,
        history: [...(history?.prompts ?? [])],
        historySize: PROMPTS_KEPT,
      })
      rl.on('line', (l) => {
        // readline has already kept the line; whether it should be is decided
        // by the question it answers (remember, below).
        forget(l)
        if (pasting) return void pasted.push(l)
        const whole = [...pasted, l].join('\n')
        pasted = []
        deliver(whole)
      })
      rl.on('close', () => {
        closed = true
        if (terminal) output.write(PASTE_OFF)
        for (const w of waiting.splice(0)) w(null)
      })
      if (terminal) {
        output.write(PASTE_ON)
        input.on('keypress', (_s: string, key?: { name?: string }) => {
          if (key?.name === 'paste-start') pasting = true
          else if (key?.name === 'paste-end') pasting = false
        })
      }
      rl.on('SIGINT', () => {
        const typed = !!rl!.line || pasted.length > 0
        const clear = () => {
          pasted = []
          rl!.write(null, { ctrl: true, name: 'u' })
          rl!.write(null, { ctrl: true, name: 'k' })
        }
        // Something typed at a question: ^C clears it, as a shell does (CLI-7).
        if (typed && shows !== 'nothing') return clear()
        // A turn running: ^C stops it, and what was typed ahead goes with it
        // (CLI-25, CLI-28).
        if (onInterrupt?.()) return void (typed && clear())
        // Otherwise it ends the session instead of killing the process mid-write.
        rl!.close()
      })
    }
    return rl
  }
  return {
    ask: async (prompt, { secret = false, signal, remember: keep } = {}) => {
      const r = open()
      const kept = (l: string | null) => {
        if (l !== null && keep?.(l)) remember(l)
        return l
      }
      if (lines.length) return kept(lines.shift()!)
      // Input already at EOF: waiting would stall the agent instead of refusing.
      if (closed || signal?.aborted) return null
      // Typed ahead of a key's question: it would show, and is no key anyway.
      if (secret && (output as { isTTY?: boolean }).isTTY) {
        r.write(null, { ctrl: true, name: 'u' })
        r.write(null, { ctrl: true, name: 'k' })
      }
      shows = 'all'
      r.setPrompt(prompt)
      // The cursor stays at the end of anything typed ahead.
      r.prompt(true)
      if (secret) shows = 'newline'
      // A question given up on (the turn stopped) must not take the next line typed.
      const waitFor = (after: (l: string | null) => void = () => {}) =>
        new Promise<string | null>((resolve) => {
          const answer = (l: string | null) => {
            shows = 'nothing'
            signal?.removeEventListener('abort', gaveUp)
            after(l)
            resolve(l)
          }
          const gaveUp = () => {
            const at = waiting.indexOf(answer)
            if (at >= 0) waiting.splice(at, 1)
            output.write('\n')
            answer(null)
          }
          signal?.addEventListener('abort', gaveUp, { once: true })
          waiting.push(answer)
        })
      // A key shows nothing as it is typed but the newline that ends it.
      return waitFor().then(secret ? (l) => l : kept)
    },
    listen: () => void open(),
    close: () => rl?.close(),
  }
}

/**
 * Asked once per command, never remembered. A closed or redirected stdin
 * answers nothing, and nothing is a refusal — silence must not read as consent.
 */
export function makeApprover(
  io: { input: Readable; output: Writable } | { line: Line },
): Approver {
  const line = 'line' in io ? io.line : makeLine(io)
  return {
    approve: async (command, signal) => {
      // Shown as typed: an escape sequence in it could otherwise redraw the question.
      const always = allowable(command)
      const answer = (await line.ask(`\n${bold('run?')} ${visible(command)}\n${dim(always ? '[y/N/a]' : '[y/N]')} `, { signal }))?.trim().toLowerCase()
      return answer === 'y' || (always && answer === 'a' ? 'always' : false)
    },
    approveChange: async (summary, change, signal) => {
      const answer = await line.ask(`\n${colorDiff(change.diff)}\n${bold('write?')} ${visible(summary)}\n${dim('[y/N]')} `, { signal })
      return (answer ?? '').trim().toLowerCase() === 'y'
    },
    close: () => line.close(),
  }
}

export type Verdict = 'safe' | 'unsafe' | 'unknown'

/** What the user can answer about a command: no, yes, or yes and from now on (TL-43). */
export type Answer = boolean | 'always'

/** Chaining, redirection and substitution: a command holding any can run more than its prefix says (TL-41). */
const COMPOUND = /[;&|<>`\n\r]|\$\(/

/** Spaces and tabs only, as the shell splits on: other blanks are part of an argument. */
const trimmed = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, '')

/** Whether a command could ever be allowed: one plain command with arguments (TL-41). */
export const allowable = (command: string) => !!trimmed(command) && !COMPOUND.test(command)

/**
 * Whether `command` is one the user said always to run (TL-41): an entry
 * exactly, or, for an entry ending in ` *`, what comes before it followed by
 * more arguments. Only an entry written by hand has a `*`; "always" saves
 * the command as it was shown.
 */
export function allowed(command: string, allow: unknown): boolean {
  if (!Array.isArray(allow) || !allowable(command)) return false
  const c = trimmed(command)
  return allow.some((entry) => {
    const e = typeof entry === 'string' ? trimmed(entry) : ''
    if (!e) return false
    if (!e.endsWith(' *')) return c === e
    const head = trimmed(e.slice(0, -1))
    return !!head && (c === head || c.startsWith(`${head} `))
  })
}

/** Adds a command to `allow` in config.json, leaving everything else as it was (TL-43). */
export async function allowCommand(command: string, dir: string): Promise<void> {
  const { updateConfig } = await import('./setup-core.ts')
  const c = trimmed(command)
  await updateConfig((config) => {
    const allow: unknown[] = Array.isArray(config.allow) ? config.allow : []
    return allow.includes(c) ? config : { ...config, allow: [...allow, c] }
  }, dir)
}

/**
 * The allowlist first, then the judge, then the user. Only a clear 'safe'
 * skips the question: 'unknown' covers a model error or a hedged answer, and
 * neither is consent.
 */
export function gated({
  judge,
  ask,
  mode,
  allow,
  remember,
  onAuto,
}: {
  judge: (command: string) => Promise<Verdict>
  ask: (command: string) => Promise<Answer>
  /** 'ask' never consults the judge. */
  mode?: string
  /** The allowlist now: read on each command, so an "always" counts at once. */
  allow?: () => unknown
  /** Called on an "always" answer, to keep the command allowed (TL-43). */
  remember?: (command: string) => Promise<void>
  onAuto?: (command: string, how: 'judged' | 'allowed') => void
}): (command: string) => Promise<boolean> {
  return async (command) => {
    if (allowed(command, allow?.())) {
      onAuto?.(command, 'allowed')
      return true
    }
    if (mode !== 'ask' && (await judge(command)) === 'safe') {
      onAuto?.(command, 'judged')
      return true
    }
    const answer = await ask(command)
    // Never kept for a command that could not be allowed anyway.
    if (answer === 'always' && allowable(command)) await remember?.(command)
    return answer === true || answer === 'always'
  }
}
