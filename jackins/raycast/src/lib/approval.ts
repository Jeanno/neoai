/** A shell command waiting for the user (RAY-3). */
export interface Approval {
  command: string
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
    show({ command, answer: settle })
  })
}
