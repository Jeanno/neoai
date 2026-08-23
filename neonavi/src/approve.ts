import { createInterface, type Interface } from 'node:readline/promises'
import { once } from 'node:events'
import type { Readable, Writable } from 'node:stream'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

export interface Approver {
  approve: (command: string) => Promise<boolean>
  close: () => void
}

/**
 * Asked once per command, never remembered. A closed or redirected stdin
 * answers nothing, and nothing is a refusal — silence must not read as consent.
 */
export function makeApprover({ input, output }: { input: Readable; output: Writable }): Approver {
  // Built on first use, not at construction: a readline interface starts
  // draining its input immediately, and the CLI does not ask until the model's
  // first tool call seconds later — by which time piped input is long gone.
  let rl: Interface | null = null

  return {
    approve: async (command) => {
      rl ??= createInterface({ input, output })
      // readline leaves question() pending forever when input is already at EOF,
      // which would stall the agent instead of refusing. Close is an answer: no.
      const answer = await Promise.race([
        rl.question(`\n${bold('run?')} ${command}\n${dim('[y/N]')} `).catch(() => ''),
        once(rl, 'close').then(() => ''),
      ])
      return answer.trim().toLowerCase() === 'y'
    },
    close: () => rl?.close(),
  }
}
