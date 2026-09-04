import { createInterface, type Interface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

/** One readline shared by everything that reads stdin: prompts and approvals alike. */
export interface Line {
  /** The line typed, or null when input is gone (EOF, ^C, ^D). */
  ask: (prompt: string) => Promise<string | null>
  close: () => void
}

export interface Approver {
  approve: (command: string) => Promise<boolean>
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
    ask: async (prompt) => {
      const r = open()
      if (lines.length) return lines.shift()!
      // Input already at EOF: waiting would stall the agent instead of refusing.
      if (closed) return null
      r.setPrompt(prompt)
      r.prompt()
      return new Promise((resolve) => waiting.push(resolve))
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
    close: () => line.close(),
  }
}
