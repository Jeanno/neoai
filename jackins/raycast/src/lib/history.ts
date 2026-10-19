import { LocalStorage } from '@raycast/api'
import { parseChats, serializeChats, upsert, type Chat } from './chats'

export { newChat, titleFrom, type Chat } from './chats'

const KEY = 'chats'

/** Chats in Raycast's own storage (RAY-4), newest first. */
export async function loadChats(): Promise<Chat[]> {
  return parseChats(await LocalStorage.getItem<string>(KEY))
}

export async function saveChat(chat: Chat): Promise<void> {
  await LocalStorage.setItem(KEY, serializeChats(upsert(await loadChats(), chat)))
}

export async function deleteChat(id: string): Promise<void> {
  const chats = (await loadChats()).filter((c) => c.id !== id)
  await LocalStorage.setItem(KEY, serializeChats(chats))
}

export async function clearChats(): Promise<void> {
  await LocalStorage.removeItem(KEY)
}
