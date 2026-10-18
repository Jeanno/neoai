import { showToast, Toast } from '@raycast/api'
import { streamText, type ModelMessage } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveNavi } from './model'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^neorouter: /, '') : String(error)
}

/**
 * One streamed answer at a time, aborted when the view unmounts. run() resolves
 * with the full answer, the partial answer if stopped, or undefined on error.
 */
export function useNavi() {
  const [text, setText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [label, setLabel] = useState<string>()
  const controller = useRef<AbortController | null>(null)
  const latest = useRef('')

  useEffect(() => {
    resolveNavi().then(
      (navi) => setLabel(navi.local ? navi.label : `${navi.label} (remote)`),
      () => setLabel('no model'),
    )
    return () => controller.current?.abort()
  }, [])

  const run = useCallback(async (messages: ModelMessage[]): Promise<string | undefined> => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    latest.current = ''
    setText('')
    setStreaming(true)
    try {
      const { llm } = await resolveNavi()
      // Errors arrive as stream parts; onError would only log them a second time.
      const result = streamText({ model: llm, messages, abortSignal: current.signal, onError: () => {} })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          latest.current += part.text
          setText(latest.current)
        } else if (part.type === 'error') {
          throw part.error
        }
      }
      return latest.current
    } catch (error) {
      if (current.signal.aborted) return latest.current || undefined
      await showToast({ style: Toast.Style.Failure, title: 'Navi could not answer', message: errorMessage(error) })
      return undefined
    } finally {
      if (controller.current === current) setStreaming(false)
    }
  }, [])

  const stop = useCallback(() => controller.current?.abort(), [])

  return { text, streaming, label, run, stop }
}
