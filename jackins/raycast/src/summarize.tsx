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
import { ApprovalSection, NoModel } from './common'
import { whereLabel } from './lib/labels'
import { summarizePrompt } from './lib/rewrite'
import { answerOf, turnMarkdown } from './lib/turn'
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
  const { navi, turn, streaming, approval, run, stop, recheck } = useNavi()
  const summarize = () => {
    // The harness brings its own system prompt (RAY-1), so the instructions travel with the text.
    const { system, prompt } = summarizePrompt(source.text)
    run(`${system}\n\n${prompt}`)
  }

  // No run-once guard: React's dev-mode remount aborts the first request, so it must be sent again.
  // Run again after Set Up Navi finds a model.
  useEffect(() => {
    if (navi) summarize()
  }, [navi])

  if (navi === null) return <NoModel onDone={recheck} />

  const summary = answerOf(turn)

  return (
    <Detail
      navigationTitle="Summary"
      isLoading={streaming && !approval}
      markdown={turnMarkdown(turn, { streaming, showReasoning, approval: approval?.command })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Source" text={source.from} />
          <Detail.Metadata.Label title="Length" text={`${source.text.trim().split(/\s+/).length} words`} />
          <Detail.Metadata.Label title="Model" text={navi ? whereLabel(navi) : 'resolving…'} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {approval && <ApprovalSection approval={approval} />}
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
          {!streaming && navi && (
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
