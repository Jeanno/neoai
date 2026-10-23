import type { FileChange } from 'neonavi/harness'

/** A shell command or file change waiting for the user (RAY-3). */
export interface Approval {
  /** The command, or a file change's one-line summary. */
  command: string
  /** Set for a file change, whose diff is shown (TL-38). */
  change?: FileChange
  answer: (run: boolean) => void
}

/**
 * The harness's approve callback (HAR-4) for a view: shows the command
 * through `show` and waits for an answer. The turn's signal aborting, from
 * Stop or leaving the view, declines; only the first answer counts.
 */
export function waitForAnswer(
  command: string,
  signal: AbortSignal,
  show: (approval: Approval | null) => void,
  change?: FileChange,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false)
    let settled = false
    const settle = (run: boolean) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', declined)
      show(null)
      resolve(run)
    }
    const declined = () => settle(false)
    signal.addEventListener('abort', declined, { once: true })
    show({ command, ...(change && { change }), answer: settle })
  })
}
