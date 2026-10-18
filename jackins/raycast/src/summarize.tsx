import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  getPreferenceValues,
  getSelectedText,
  Icon,
  Keyboard,
} from '@raycast/api'
import { useEffect, useState } from 'react'
import { summarizePrompt } from './lib/rewrite'
import { splitThinking, toMarkdown } from './lib/think'
import { useNavi } from './lib/use-navi'

type Source = { text: string; from: 'Selected text' | 'Clipboard' }

async function readSource(): Promise<Source | null> {
  try {
    const text = await getSelectedText()
    if (text.trim()) return { text, from: 'Selected text' }
  } catch {
    // Nothing selected: fall back to the clipboard.
  }
  const text = (await Clipboard.readText()) ?? ''
  return text.trim() ? { text, from: 'Clipboard' } : null
}

function Summary({ source }: { source: Source }) {
  const { showReasoning } = getPreferenceValues<Preferences>()
  const { text, streaming, label, run, stop } = useNavi()
  const summarize = () => {
    const { system, prompt } = summarizePrompt(source.text)
    run([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ])
  }

  // No run-once guard: React's dev-mode remount aborts the first request, so it must be sent again.
  useEffect(() => {
    summarize()
  }, [])

  const summary = splitThinking(text).answer

  return (
    <Detail
      navigationTitle="Summary"
      isLoading={streaming}
      markdown={toMarkdown(text, streaming, showReasoning)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Source" text={source.from} />
          <Detail.Metadata.Label title="Length" text={`${source.text.trim().split(/\s+/).length} words`} />
          <Detail.Metadata.Label title="Model" text={label ?? 'resolving…'} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {summary && <Action.CopyToClipboard title="Copy Summary" content={summary} />}
          {summary && <Action.Paste title="Paste Summary" content={summary} />}
          {streaming && (
            <Action
              title="Stop"
              icon={Icon.Stop}
              shortcut={{ modifiers: ['cmd', 'shift'], key: '.' }}
              onAction={stop}
            />
          )}
          {!streaming && (
            <Action
              title="Regenerate"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={summarize}
            />
          )}
          <Action.CopyToClipboard
            title="Copy Original Text"
            content={source.text}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        </ActionPanel>
      }
    />
  )
}

export default function Command() {
  const [source, setSource] = useState<Source | null>()

  useEffect(() => {
    readSource().then(setSource, () => setSource(null))
  }, [])

  if (source) return <Summary source={source} />
  return (
    <Detail
      isLoading={source === undefined}
      markdown={source === null ? '## Nothing to summarize\n\nSelect some text, or copy it, and try again.' : ''}
    />
  )
}
