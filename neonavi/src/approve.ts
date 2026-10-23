import { createInterface, type Interface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import { visible, type FileChange } from './diff.ts'

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
  ask: (prompt: string, opts?: { secret?: boolean }) => Promise<string | null>
  close: () => void
}

export interface Approver {
  /** `[y/N/a]`, or `[y/N]` for a command that could never be allowed (TL-43). */
  approve: (command: string) => Promise<Answer>
  /** Shows the diff, then asks about the change by its summary (TL-38). */
  approveChange: (summary: string, change: FileChange) => Promise<boolean>
  close: () => void
}

export function makeLine({ input, output }: { input: Readable; output: Writable }): Line {
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
  const open = () => {
    if (!rl) {
      rl = createInterface({ input, output })
      rl.on('line', (l) => (waiting.length ? waiting.shift()!(l) : lines.push(l)))
      rl.on('close', () => {
        closed = true
        for (const w of waiting.splice(0)) w(null)
      })
      // ^C at a prompt ends the session instead of killing the process mid-write.
      rl.on('SIGINT', () => rl?.close())
    }
    return rl
  }
  return {
    ask: async (prompt, { secret = false } = {}) => {
      const r = open()
      if (lines.length) return lines.shift()!
      // Input already at EOF: waiting would stall the agent instead of refusing.
      if (closed) return null
      r.setPrompt(prompt)
      r.prompt()
      if (!secret) return new Promise((resolve) => waiting.push(resolve))
      // Everything readline draws while the key is typed is dropped, except the
      // newline that ends it. Muting the stream rather than readline itself
      // holds across Node versions, whose internals have moved.
      const write = output.write
      output.write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
        const done = (typeof enc === 'function' ? enc : cb) as (() => void) | undefined
        if (String(chunk).includes('\n')) return write.call(output, '\n', 'utf8', done)
        done?.()
        return true
      }) as typeof output.write
      return new Promise((resolve) =>
        waiting.push((l) => {
          output.write = write
          resolve(l)
        }),
      )
    },
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
    approve: async (command) => {
      // Shown as typed: an escape sequence in it could otherwise redraw the question.
      const always = allowable(command)
      const answer = (await line.ask(`\n${bold('run?')} ${visible(command)}\n${dim(always ? '[y/N/a]' : '[y/N]')} `))?.trim().toLowerCase()
      return answer === 'y' || (always && answer === 'a' ? 'always' : false)
    },
    approveChange: async (summary, change) => {
      const answer = await line.ask(`\n${colorDiff(change.diff)}\n${bold('write?')} ${visible(summary)}\n${dim('[y/N]')} `)
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
