import type { ModelMessage } from 'ai'
import { randomUUID } from 'node:crypto'
import { splitThinking } from './think'
import { turnFromHistory, userText, type Turn } from './turn'

/**
 * A chat is the harness's history and a little about it (RAY-4): stored as
 * is, and passed back to `harness.session(history)` to continue it (HAR-3).
 */
export type Chat = { id: string; title: string; history: ModelMessage[]; updatedAt: number }

/** A question paired with the turn that answered it. */
export type Exchange = { id: string; question: string; turn: Turn }

export function newChat(history: ModelMessage[] = []): Chat {
  return { id: randomUUID(), title: titleFrom(history), history, updatedAt: Date.now() }
}

export function titleFrom(history: ModelMessage[]): string {
  const first = history.find((m) => m.role === 'user')
  const text = (first ? userText(first) : '').trim() || 'New Chat'
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/**
 * Stored chats, newest first. Chats saved before the harness kept `messages`
 * of plain user and assistant text, which is history too. Anything unreadable
 * is dropped rather than failing the whole list.
 */
export function parseChats(raw: string | undefined): Chat[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const chats: Chat[] = []
  for (const c of parsed) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue
    const history = Array.isArray(c.history) ? c.history : Array.isArray(c.messages) ? c.messages : null
    if (!history) continue
    chats.push({
      id: c.id,
      title: typeof c.title === 'string' ? c.title : titleFrom(history),
      history,
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
    })
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function serializeChats(chats: Chat[]): string {
  return JSON.stringify(chats)
}

/** The list with one chat put first, replacing its older copy. */
export function upsert(chats: Chat[], chat: Chat): Chat[] {
  return [chat, ...chats.filter((c) => c.id !== chat.id)]
}

/**
 * History without the model's reasoning: it would crowd the context on every
 * later turn. An assistant message left with nothing is dropped.
 */
export function withoutThinking(history: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of history) {
    if (m.role !== 'assistant') {
      out.push(m)
      continue
    }
    if (typeof m.content === 'string') {
      const answer = splitThinking(m.content).answer
      if (answer) out.push({ ...m, content: answer })
      continue
    }
    const content = m.content
      .map((p) => (p.type === 'text' ? { ...p, text: splitThinking(p.text).answer } : p))
      .filter((p) => p.type !== 'text' || p.text)
    if (content.length) out.push({ ...m, content })
  }
  return out
}

/** How many questions a chat holds. */
export function turns(history: ModelMessage[]): number {
  return history.filter((m) => m.role === 'user').length
}

/** Newest first: each question with the assistant and tool messages after it. */
export function exchanges(history: ModelMessage[]): Exchange[] {
  const out: Exchange[] = []
  let start = -1
  const close = (end: number) => {
    if (start < 0) return
    out.push({
      id: String(start),
      question: userText(history[start]),
      turn: turnFromHistory(history.slice(start + 1, end)),
    })
  }
  history.forEach((m, i) => {
    if (m.role !== 'user') return
    close(i)
    start = i
  })
  close(history.length)
  return out.reverse()
}
