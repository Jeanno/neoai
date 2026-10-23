import { createInterface, type Interface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import type { FileChange } from './diff.ts'

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
  approve: (command: string) => Promise<boolean>
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
      const answer = await line.ask(`\n${bold('run?')} ${command}\n${dim('[y/N]')} `)
      return (answer ?? '').trim().toLowerCase() === 'y'
    },
    approveChange: async (summary, change) => {
      const answer = await line.ask(`\n${colorDiff(change.diff)}\n${bold('write?')} ${summary}\n${dim('[y/N]')} `)
      return (answer ?? '').trim().toLowerCase() === 'y'
    },
    close: () => line.close(),
  }
}

export type Verdict = 'safe' | 'unsafe' | 'unknown'

/**
 * Judge first, ask second. Only a clear 'safe' skips the question: 'unknown'
 * covers a model error or a hedged answer, and neither is consent.
 */
export function gated({
  judge,
  ask,
  mode,
  onAuto,
}: {
  judge: (command: string) => Promise<Verdict>
  ask: (command: string) => Promise<boolean>
  /** 'ask' never consults the judge. */
  mode?: string
  onAuto?: (command: string) => void
}): Approver['approve'] {
  return async (command) => {
    if (mode !== 'ask' && (await judge(command)) === 'safe') {
      onAuto?.(command)
      return true
    }
    return ask(command)
  }
}
