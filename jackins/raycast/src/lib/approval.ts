import { allowable, type Answer, type FileChange } from 'neonavi/harness'

/** A shell command, file change or browser action waiting for the user (RAY-3). */
export interface Approval {
  /** The command, a file change's one-line summary, or what the browser would do. */
  command: string
  /** Set for a file change, whose diff is shown (TL-38). */
  change?: FileChange
  /** Set for a browser action: the page it is on (BRW-11). */
  action?: { url: string }
  /** Whether Always Allow is offered: only for a command that could be allowed (TL-43). */
  always: boolean
  answer: (run: Answer) => void
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
  action?: { url: string },
): Promise<Answer> {
  return new Promise<Answer>((resolve) => {
    if (signal.aborted) return resolve(false)
    let settled = false
    const settle = (run: Answer) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', declined)
      show(null)
      resolve(run)
    }
    const declined = () => settle(false)
    signal.addEventListener('abort', declined, { once: true })
    // A browser action is never remembered, so never offered "always" (BRW-11).
    show({
      command,
      ...(change && { change }),
      ...(action && { action }),
      always: !change && !action && allowable(command),
      answer: settle,
    })
  })
}
