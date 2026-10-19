import { Action, ActionPanel, Alert, confirmAlert, Icon, List } from '@raycast/api'
import { useCallback, useEffect, useState } from 'react'
import { Conversation } from './conversation'
import { turns } from './lib/chats'
import { Chat, clearChats, deleteChat, loadChats } from './lib/history'

export default function Command() {
  const [chats, setChats] = useState<Chat[]>()
  const reload = useCallback(() => loadChats().then(setChats), [])

  useEffect(() => {
    reload()
  }, [reload])

  async function confirmClear() {
    const confirmed = await confirmAlert({
      title: 'Delete all chats?',
      primaryAction: { title: 'Delete All', style: Alert.ActionStyle.Destructive },
    })
    if (!confirmed) return
    await clearChats()
    await reload()
  }

  return (
    <List isLoading={chats === undefined} searchBarPlaceholder="Search chats…">
      <List.Item
        title="New Chat"
        icon={Icon.Plus}
        actions={
          <ActionPanel>
            <Action.Push title="New Chat" icon={Icon.Plus} target={<Conversation />} onPop={reload} />
          </ActionPanel>
        }
      />
      <List.Section title="Recent">
        {chats?.map((chat) => (
          <List.Item
            key={chat.id}
            title={chat.title}
            icon={Icon.SpeechBubble}
            accessories={[{ text: `${turns(chat.history)} turns` }, { date: new Date(chat.updatedAt) }]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Open Chat"
                  icon={Icon.ArrowRight}
                  target={<Conversation initialChat={chat} />}
                  onPop={reload}
                />
                <Action
                  title="Delete Chat"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ['ctrl'], key: 'x' }}
                  onAction={() => deleteChat(chat.id).then(reload)}
                />
                <Action
                  title="Delete All Chats"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ['ctrl', 'shift'], key: 'x' }}
                  onAction={confirmClear}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  )
}
