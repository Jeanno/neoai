import { showToast, Toast } from '@raycast/api'
import type { ModelMessage } from 'ai'
import { createHarness, type Harness } from 'neonavi/harness'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, forgetNavi, naviHome, resolveNavi, type Navi } from './model'
import { waitForAnswer, type Approval } from './approval'
import { applyEvent, emptyTurn, type Turn } from './turn'

export interface Answered {
  turn: Turn
  /** What to store and pass back to continue (HAR-3). */
  history: ModelMessage[]
}

/**
 * One harness turn at a time, stopped when the view unmounts (RAY-1). `navi`
 * is undefined while resolving and null when no model answers (RAY-7). run()
 * resolves with the turn and its history, or undefined when nothing answered.
 */
export function useNavi() {
  const [navi, setNavi] = useState<Navi | null>()
  const [turn, setTurn] = useState<Turn>(emptyTurn)
  const [streaming, setStreaming] = useState(false)
  const [approval, setApproval] = useState<Approval | null>(null)
  const controller = useRef<AbortController | null>(null)
  const harness = useRef<{ navi: Navi; harness: Promise<Harness> } | null>(null)

  const resolve = useCallback(() => {
    resolveNavi().then(setNavi, async (error) => {
      setNavi(null)
      await showToast({ style: Toast.Style.Failure, title: 'Navi could not start', message: errorMessage(error) })
    })
  }, [])

  useEffect(() => {
    resolve()
    // Leaving the view stops the answer, which also declines a pending command (RAY-3).
    return () => controller.current?.abort()
  }, [])

  /** After Set Up Navi: look again, since the chain may have changed. */
  const recheck = useCallback(() => {
    forgetNavi()
    harness.current = null
    setNavi(undefined)
    resolve()
  }, [])

  // Shows the command and waits; Stop or leaving the view declines (RAY-3).
  const approve = useCallback(
    (command: string, { signal }: { signal: AbortSignal }) => waitForAnswer(command, signal, setApproval),
    [],
  )

  const harnessFor = (n: Navi): Promise<Harness> => {
    if (harness.current?.navi !== n) {
      const made = naviHome().then((cwd) =>
        createHarness({ model: n.model, contextWindow: n.chosen.contextWindow, cwd, approve }),
      )
      // A failed start is not kept, so asking again tries again.
      made.catch(() => (harness.current = null))
      harness.current = { navi: n, harness: made }
    }
    return harness.current.harness
  }

  const run = useCallback(async (prompt: string, history: ModelMessage[] = []): Promise<Answered | undefined> => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    const live = () => controller.current === current
    let t = emptyTurn()
    let stored: ModelMessage[] | undefined
    setTurn(t)
    setStreaming(true)
    try {
      const n = await resolveNavi()
      setNavi(n)
      if (!n) return undefined
      const session = (await harnessFor(n)).session(history)
      for await (const e of session.turn(prompt, { signal: current.signal })) {
        t = applyEvent(t, e)
        if (live()) setTurn(t)
        if (e.type === 'done') stored = e.history
      }
    } catch (error) {
      t = { ...t, errors: [...t.errors, errorMessage(error)] }
      if (live()) setTurn(t)
    } finally {
      if (live()) setStreaming(false)
    }
    if (t.errors.length && !current.signal.aborted)
      await showToast({ style: Toast.Style.Failure, title: 'Navi could not answer', message: t.errors[0] })
    return stored && { turn: t, history: stored }
  }, [])

  const stop = useCallback(() => controller.current?.abort(), [])

  return { navi, turn, streaming, approval, run, stop, recheck }
}
