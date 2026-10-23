import { Action, ActionPanel, Detail, getPreferenceValues, Icon, Keyboard, LaunchProps, List } from '@raycast/api'
import type { ModelMessage } from 'ai'
import type { Attachment } from 'neonavi/harness'
import { useEffect, useState } from 'react'
import { ApprovalSection, NoModel } from './common'
import { Conversation } from './conversation'
import { newChat, withoutThinking } from './lib/chats'
import { whereLabel } from './lib/labels'
import { answerOf, turnMarkdown } from './lib/turn'
import { useNavi } from './lib/use-navi'

/** One question and its streamed answer; `attachments` go with it (RAY-11). */
export function Answer({ question, attachments }: { question: string; attachments?: Attachment[] }) {
  const { showReasoning } = getPreferenceValues<Preferences>()
  const { navi, turn, streaming, approval, run, stop, recheck } = useNavi()
  const [history, setHistory] = useState<ModelMessage[]>()
  const ask = async () => {
    setHistory(undefined)
    setHistory((await run(question, [], attachments))?.history)
  }

  // No run-once guard: React's dev-mode remount aborts the first request, so it must be sent again.
  // Asked again after Set Up Navi finds a model.
  useEffect(() => {
    if (navi) ask()
  }, [navi])

  if (navi === null) return <NoModel onDone={recheck} />

  const answer = answerOf(turn)

  return (
    <Detail
      navigationTitle={question}
      isLoading={streaming && !approval}
      markdown={turnMarkdown(turn, { streaming, showReasoning, approval })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Question" text={question} />
          {attachments?.length ? (
            <Detail.Metadata.TagList title="Files">
              {attachments.map((a) => (
                <Detail.Metadata.TagList.Item key={a.name} text={a.name} />
              ))}
            </Detail.Metadata.TagList>
          ) : null}
          <Detail.Metadata.Label title="Model" text={navi ? whereLabel(navi) : 'resolving…'} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {approval && <ApprovalSection approval={approval} />}
          {answer && <Action.CopyToClipboard title="Copy Answer" content={answer} />}
          {answer && <Action.Paste title="Paste Answer" content={answer} />}
          {streaming && (
            <Action
              title="Stop"
              icon={Icon.Stop}
              shortcut={{ modifiers: ['cmd', 'shift'], key: '.' }}
              onAction={stop}
            />
          )}
          {!streaming && history && (
            <Action.Push
              title="Continue in Chat"
              icon={Icon.SpeechBubble}
              shortcut={{ modifiers: ['cmd'], key: 'j' }}
              target={<Conversation initialChat={newChat(withoutThinking(history))} />}
            />
          )}
          {!streaming && navi && (
            <Action
              title="Regenerate"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={ask}
            />
          )}
        </ActionPanel>
      }
    />
  )
}

export default function Command(props: LaunchProps<{ arguments: Arguments.AskAi }>) {
  const initial = (props.arguments.prompt || props.fallbackText || '').trim()
  const [input, setInput] = useState('')

  if (initial) return <Answer question={initial} />

  return (
    <List searchBarPlaceholder="Ask navi…" searchText={input} onSearchTextChange={setInput} filtering={false}>
      <List.EmptyView
        icon={Icon.QuestionMarkCircle}
        title={input.trim() ? 'Press Enter to ask' : 'Type a question'}
        actions={
          input.trim() ? (
            <ActionPanel>
              <Action.Push title="Ask" icon={Icon.ArrowRight} target={<Answer question={input.trim()} />} />
            </ActionPanel>
          ) : undefined
        }
      />
    </List>
  )
}
