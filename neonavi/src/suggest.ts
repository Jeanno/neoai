import { generateText, type ModelMessage } from 'ai'
import type { Model } from './harness.ts'
import { checkFact } from './memory.ts'
import { exchanges } from './transcript.ts'

/**
 * Facts worth remembering, suggested when a conversation ends (MEM-20 to
 * MEM-22). The model is shown only what the user typed, never answers, files
 * or pages, so nothing it read can be put forward as the user's.
 */

/** How many answered turns a conversation needs before navi asks. */
export const SUGGEST_AFTER = 3
const MOST = 2
/** The prompts shown, newest kept, each cut short. */
const SHOWN = 20
const EACH = 500

export interface Suggestion {
  fact: string
  /** About the project this directory is in, rather than the user. */
  project: boolean
}

const ASK = `You help an assistant remember things between conversations. Below are the messages a user typed in one conversation. List at most ${MOST} lasting facts the user stated about themselves, how they like to work, or the project they are working in, that would help in later conversations: preferences, names, tools, conventions. Not the task of the moment, not questions, not anything the user only asked about. Write each on its own line, starting "you: " for a fact about the user or "project: " for one about the project, then the fact as a short note without naming the user, as in "you: Prefers tabs to spaces" or "project: Tests run with make check". If there is nothing like that, answer NONE.`

/** What the user typed in this conversation, newest last. */
export function typed(history: ModelMessage[]): string[] {
  return exchanges(history)
    .map((e) => e.prompt.trim())
    .filter(Boolean)
    .slice(-SHOWN)
    .map((p) => (p.length > EACH ? `${p.slice(0, EACH - 1)}…` : p))
}

/** The model's lines as facts: the known, the malformed and the over-long left out (MEM-6). */
export function parseSuggestions(text: string, known: { you: string[]; project?: string[] }): Suggestion[] {
  const out: Suggestion[] = []
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:[-*]\s*)?(you|project)\s*:\s*(.+?)\s*$/i.exec(raw)
    if (!m) continue
    const project = m[1].toLowerCase() === 'project'
    // Outside a project, a fact about one has nowhere to go.
    if (project && !known.project) continue
    const fact = m[2].replace(/^["“]|["”]$/g, '')
    const facts = project ? known.project! : known.you
    if (checkFact(fact, [...facts, ...out.filter((s) => s.project === project).map((s) => s.fact)])) continue
    out.push({ fact, project })
    if (out.length === MOST) break
  }
  return out
}

/** Asks the model once, without tools; nothing when it finds nothing or fails. */
export async function suggestFacts(
  model: Model,
  history: ModelMessage[],
  known: { you: string[]; project?: string[] },
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const prompts = typed(history)
  if (!prompts.length) return []
  try {
    const { text } = await generateText({
      model,
      system: ASK,
      prompt: prompts.map((p, i) => `${i + 1}. ${p}`).join('\n'),
      maxOutputTokens: 200,
      abortSignal: signal,
    })
    return parseSuggestions(text, known)
  } catch {
    return []
  }
}
