import { Action, ActionPanel, getPreferenceValues, Icon, Keyboard, List } from '@raycast/api'
import { useState } from 'react'
import { ApprovalSection, SetUpAction } from './common'
import { NO_MODEL_TITLE } from './lib/offer-set-up'
import { exchanges, newChat, titleFrom, withoutThinking, type Chat, type Exchange } from './lib/chats'
import { saveChat } from './lib/history'
import { whereLabel } from './lib/labels'
import { answerOf, turnMarkdown } from './lib/turn'
import { useNavi } from './lib/use-navi'

export function Conversation({ initialChat }: { initialChat?: Chat }) {
  const { showReasoning } = getPreferenceValues<Preferences>()
  const [chat, setChat] = useState<Chat>(initialChat ?? newChat())
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const { navi, turn, streaming, approval, run, stop, recheck } = useNavi()

  async function send() {
    const question = input.trim()
    if (!question || streaming || !navi) return
    setInput('')
    setPending(question)
    // The stored history goes back into a harness session, so the chat continues (RAY-4, HAR-3).
    const answered = await run(question, chat.history)
    setPending(null)
    const said = answered && (answerOf(answered.turn) || answered.turn.items.length > 0)
    if (!answered || (!said && answered.turn.errors.length)) {
      setInput(question)
      return
    }
    // Reasoning is not kept: it would crowd the context on every later turn.
    const updated: Chat = {
      ...chat,
      title: chat.history.length ? chat.title : titleFrom(answered.history),
      history: withoutThinking(answered.history),
      updatedAt: Date.now(),
    }
    setChat(updated)
    await saveChat(updated)
  }

  const shown: Exchange[] = exchanges(chat.history)
  if (pending) shown.unshift({ id: 'pending', question: pending, turn })

  const actions = (exchange?: Exchange) => {
    const answer = exchange && answerOf(exchange.turn)
    return (
      <ActionPanel>
        {navi === null && <SetUpAction onDone={recheck} />}
        {approval && <ApprovalSection approval={approval} />}
        {input.trim() && !streaming && navi && <Action title="Send" icon={Icon.ArrowRight} onAction={send} />}
        {streaming && (
          <Action title="Stop" icon={Icon.Stop} shortcut={{ modifiers: ['cmd', 'shift'], key: '.' }} onAction={stop} />
        )}
        {answer && <Action.CopyToClipboard title="Copy Answer" content={answer} />}
        {exchange && (
          <Action.CopyToClipboard
            title="Copy Question"
            content={exchange.question}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        )}
        {!streaming && chat.history.length > 0 && (
          <Action
            title="New Chat"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            onAction={() => setChat(newChat())}
          />
        )}
      </ActionPanel>
    )
  }

  return (
    <List
      navigationTitle={chat.history.length ? chat.title : 'New Chat'}
      searchBarPlaceholder={chat.history.length ? 'Ask a follow-up…' : 'Ask navi…'}
      searchText={input}
      onSearchTextChange={setInput}
      filtering={false}
      isLoading={(streaming && !approval) || navi === undefined}
      isShowingDetail={shown.length > 0}
      selectedItemId={shown[0]?.id}
    >
      {/* Raycast hides List-level actions whenever an empty view is present, so Send lives here. */}
      <List.EmptyView
        icon={navi === null ? Icon.Warning : Icon.SpeechBubble}
        title={navi === null ? NO_MODEL_TITLE : 'Type a message and press Enter'}
        description={navi === null ? 'Press Return to open Set Up Navi.' : navi && whereLabel(navi)}
        actions={actions()}
      />
      {shown.map((exchange) => {
        const live = exchange.id === 'pending'
        return (
          <List.Item
            key={exchange.id}
            id={exchange.id}
            title={exchange.question}
            detail={
              <List.Item.Detail
                markdown={turnMarkdown(exchange.turn, {
                  streaming: live && streaming,
                  showReasoning,
                  approval: live ? approval?.command : null,
                })}
              />
            }
            actions={actions(exchange)}
          />
        )
      })}
    </List>
  )
}
