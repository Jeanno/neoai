import { generateText, type LanguageModel, type ModelMessage } from 'ai'

/** Share of the window left for the system prompt, the answer, and estimate error. */
export const RESERVE = 0.3
const TAIL_SHARE = 1 / 3

/** Four characters a token: crude, but a tokenizer per backend is not worth it. */
export function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

export function budget(contextWindow: number): number {
  return Math.floor(contextWindow * (1 - RESERVE))
}

/**
 * The tail is the most recent messages that fit, but it may only start at a
 * user message: an assistant tool call without its result, or a result without
 * its call, is rejected by every backend.
 */
export function split(messages: ModelMessage[], keepTokens: number) {
  let start = messages.length
  let size = 0
  let cut = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    size += estimateTokens([messages[i]])
    if (size > keepTokens) break
    if (messages[i].role === 'user') cut = i
    start = i
  }
  // A tail that never reached a user message would be malformed; keep none.
  const at = start <= cut ? cut : messages.length
  return { head: messages.slice(0, at), tail: messages.slice(at) }
}

const SUMMARISE = [
  'Summarise the conversation so far for your own later use. Keep: what the',
  'user is trying to do, what was found (file paths, line numbers, commands,',
  'errors, decisions), and what is still open. Drop pleasantries and',
  'narration. Plain text, no preamble.',
].join(' ')

export async function summarise(model: LanguageModel, head: ModelMessage[]): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system: SUMMARISE,
      messages: [...head, { role: 'user', content: 'Write the summary now.' }],
    })
    return text.trim() || null
  } catch {
    return null
  }
}

export interface Compacted {
  messages: ModelMessage[]
  /** How many messages were folded away; 0 when nothing changed. */
  compacted: number
}

export async function compact(
  model: LanguageModel,
  messages: ModelMessage[],
  o: { contextWindow: number; extraTokens?: number },
): Promise<Compacted> {
  const limit = budget(o.contextWindow)
  if (estimateTokens(messages) + (o.extraTokens ?? 0) <= limit) return { messages, compacted: 0 }
  const { head, tail } = split(messages, Math.floor(limit * TAIL_SHARE))
  if (!head.length) return { messages, compacted: 0 }
  const summary = await summarise(model, head)
  // A failed summary still frees the room; losing the oldest turns beats failing this one.
  const replaced: ModelMessage[] = summary
    ? [
        { role: 'user', content: `Summary of the earlier conversation:\n${summary}` },
        { role: 'assistant', content: 'Understood.' },
      ]
    : []
  return { messages: [...replaced, ...tail], compacted: head.length }
}
