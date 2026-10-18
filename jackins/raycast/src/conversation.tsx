import { Action, ActionPanel, getPreferenceValues, Icon, Keyboard, List } from '@raycast/api'
import { useState } from 'react'
import { Chat, Message, newChat, saveChat, titleFrom } from './lib/history'
import { splitThinking, toMarkdown } from './lib/think'
import { useNavi } from './lib/use-navi'

type Exchange = { id: string; question: string; answer: string }

/** Newest first, a question paired with the answer that followed it. */
function toExchanges(messages: Message[]): Exchange[] {
  const exchanges: Exchange[] = []
  messages.forEach((m, i) => {
    if (m.role !== 'user') return
    const next = messages[i + 1]
    exchanges.push({ id: String(i), question: m.content, answer: next?.role === 'assistant' ? next.content : '' })
  })
  return exchanges.reverse()
}

export function Conversation({ initialChat }: { initialChat?: Chat }) {
  const { showReasoning } = getPreferenceValues<Preferences>()
  const [chat, setChat] = useState<Chat>(initialChat ?? newChat())
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const { text, streaming, label, run, stop } = useNavi()

  async function send() {
    const question = input.trim()
    if (!question || streaming) return
    setInput('')
    setPending(question)
    const messages: Message[] = [...chat.messages, { role: 'user', content: question }]
    const answer = await run(messages)
    setPending(null)
    if (answer === undefined) {
      setInput(question)
      return
    }
    // Only the answer is kept: reasoning would crowd the context on every later turn.
    const updated: Chat = {
      ...chat,
      title: chat.messages.length ? chat.title : titleFrom(messages),
      messages: [...messages, { role: 'assistant', content: splitThinking(answer).answer }],
      updatedAt: Date.now(),
    }
    setChat(updated)
    await saveChat(updated)
  }

  const exchanges = toExchanges(chat.messages)
  if (pending) exchanges.unshift({ id: 'pending', question: pending, answer: text })

  const actions = (exchange?: Exchange) => (
    <ActionPanel>
      {input.trim() && !streaming && <Action title="Send" icon={Icon.ArrowRight} onAction={send} />}
      {streaming && (
        <Action title="Stop" icon={Icon.Stop} shortcut={{ modifiers: ['cmd', 'shift'], key: '.' }} onAction={stop} />
      )}
      {exchange?.answer && (
        <Action.CopyToClipboard title="Copy Answer" content={splitThinking(exchange.answer).answer} />
      )}
      {exchange && (
        <Action.CopyToClipboard
          title="Copy Question"
          content={exchange.question}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
      )}
      {!streaming && chat.messages.length > 0 && (
        <Action
          title="New Chat"
          icon={Icon.Plus}
          shortcut={Keyboard.Shortcut.Common.New}
          onAction={() => setChat(newChat())}
        />
      )}
    </ActionPanel>
  )

  return (
    <List
      navigationTitle={chat.messages.length ? chat.title : 'New Chat'}
      searchBarPlaceholder={chat.messages.length ? 'Ask a follow-up…' : 'Ask navi…'}
      searchText={input}
      onSearchTextChange={setInput}
      filtering={false}
      isLoading={streaming || !label}
      isShowingDetail={exchanges.length > 0}
      selectedItemId={exchanges[0]?.id}
    >
      {/* Raycast hides List-level actions whenever an empty view is present, so Send lives here. */}
      <List.EmptyView
        icon={Icon.SpeechBubble}
        title="Type a message and press Enter"
        description={label}
        actions={actions()}
      />
      {exchanges.map((exchange) => (
        <List.Item
          key={exchange.id}
          id={exchange.id}
          title={exchange.question}
          detail={
            <List.Item.Detail
              markdown={toMarkdown(exchange.answer, exchange.id === 'pending' && streaming, showReasoning)}
            />
          }
          actions={actions(exchange)}
        />
      ))}
    </List>
  )
}
