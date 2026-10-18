import { LocalStorage } from '@raycast/api'
import { randomUUID } from 'node:crypto'

export type Message = { role: 'user' | 'assistant'; content: string }
export type Chat = { id: string; title: string; messages: Message[]; updatedAt: number }

const KEY = 'chats'

export async function loadChats(): Promise<Chat[]> {
  const raw = await LocalStorage.getItem<string>(KEY)
  const chats: Chat[] = raw ? JSON.parse(raw) : []
  return chats.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveChat(chat: Chat): Promise<void> {
  const others = (await loadChats()).filter((c) => c.id !== chat.id)
  await LocalStorage.setItem(KEY, JSON.stringify([chat, ...others]))
}

export async function deleteChat(id: string): Promise<void> {
  const chats = (await loadChats()).filter((c) => c.id !== id)
  await LocalStorage.setItem(KEY, JSON.stringify(chats))
}

export async function clearChats(): Promise<void> {
  await LocalStorage.removeItem(KEY)
}

export function newChat(messages: Message[] = []): Chat {
  return { id: randomUUID(), title: titleFrom(messages), messages, updatedAt: Date.now() }
}

export function titleFrom(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user')?.content.trim() ?? 'New Chat'
  return first.length > 60 ? `${first.slice(0, 57)}…` : first
}
