import { Action, ActionPanel, Detail, getPreferenceValues, Icon, Keyboard, LaunchProps, List } from '@raycast/api'
import { useEffect, useState } from 'react'
import { Conversation } from './conversation'
import { newChat } from './lib/history'
import { splitThinking, toMarkdown } from './lib/think'
import { useNavi } from './lib/use-navi'

function Answer({ question }: { question: string }) {
  const { showReasoning } = getPreferenceValues<Preferences>()
  const { text, streaming, label, run, stop } = useNavi()
  const ask = () => run([{ role: 'user', content: question }])

  // No run-once guard: React's dev-mode remount aborts the first request, so it must be sent again.
  useEffect(() => {
    ask()
  }, [])

  const answer = splitThinking(text).answer

  return (
    <Detail
      navigationTitle={question}
      isLoading={streaming}
      markdown={toMarkdown(text, streaming, showReasoning)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Question" text={question} />
          <Detail.Metadata.Label title="Model" text={label ?? 'resolving…'} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
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
          {!streaming && answer && (
            <Action.Push
              title="Continue in Chat"
              icon={Icon.SpeechBubble}
              shortcut={{ modifiers: ['cmd'], key: 'j' }}
              target={
                <Conversation
                  initialChat={newChat([
                    { role: 'user', content: question },
                    { role: 'assistant', content: answer },
                  ])}
                />
              }
            />
          )}
          {!streaming && (
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
