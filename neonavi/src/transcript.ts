import type { ModelMessage } from 'ai'
import { splitUserContent } from './attach.ts'

/** A saved conversation as Markdown to read or share (SES-15 to SES-17). */

const SUMMARY = 'Summary of the earlier conversation:\n'

/** What a tool was given, in a few words: the command, the path, or the input cut short. */
function brief(name: string, input: unknown): string {
  // A model that sent its input as a JSON string still named a path or command in it.
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      // Shown as it is.
    }
  }
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const said = [i.command, i.path, i.url, i.query, i.fact].find((v) => typeof v === 'string') as string | undefined
  const s = said ?? (typeof input === 'string' ? input : JSON.stringify(input ?? {}))
  const one = s.replace(/\s+/g, ' ').trim()
  return `${name}: ${one.length > 100 ? `${one.slice(0, 99)}…` : one}`
}

/** Leading `(navi: …)` paragraphs: what navi told the model, not what the user typed. */
function notesOff(prompt: string): { notes: string[]; rest: string } {
  const notes: string[] = []
  let rest = prompt
  for (;;) {
    const m = /^\(navi: ([\s\S]*?)\)(?:\n\n|$)/.exec(rest)
    if (!m) return { notes, rest }
    notes.push(m[1])
    rest = rest.slice(m[0].length)
  }
}

/** A trailing `(navi: …)` paragraph, as a watch's runs carry (SCH-11), is navi's too. */
const tailOff = (prompt: string) => prompt.replace(/\n\n\(navi: [\s\S]*\)\s*$/, '')

export interface Exchange {
  prompt: string
  /** The names of files sent with it. */
  files?: string[]
  /** The last thing navi said in answer, if it said anything. */
  answer?: string
  /** Which of the files are photos, each to be had by its place here (JOB-37). */
  images?: string[]
}

type Picture = { mediaType: string; data: string }

/** A turn's photos as they were sent: a file part named as one of its files. */
function pictures(content: ModelMessage['content'], names: string[]): (Picture & { name: string })[] {
  if (typeof content === 'string') return []
  return content.flatMap((p) => {
    if (p.type !== 'file' || !p.mediaType.startsWith('image/') || !p.filename || !names.includes(p.filename)) return []
    const data = typeof p.data === 'string' ? p.data : p.data instanceof Uint8Array ? Buffer.from(p.data).toString('base64') : null
    return data && !data.includes(':') ? [{ name: p.filename, mediaType: p.mediaType, data }] : []
  })
}

function walk(messages: ModelMessage[]): { turns: Exchange[]; pics: (Picture & { name: string })[][] } {
  const turns: Exchange[] = []
  const pics: (Picture & { name: string })[][] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const { prompt, names } = splitUserContent(m.content as Parameters<typeof splitUserContent>[0])
      if (prompt.startsWith(SUMMARY)) continue
      const rest = tailOff(notesOff(prompt).rest).trim()
      // A note navi sent alone (an escalation) goes on with the turn before it.
      if (!rest && !names.length) continue
      const got = pictures(m.content, names)
      turns.push({ prompt: rest, ...(names.length && { files: names }), ...(got.length && { images: got.map((g) => g.name) }) })
      pics.push(got)
    } else if (m.role === 'assistant' && turns.length) {
      const parts = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content
      const text = parts.flatMap((p) => (p.type === 'text' && p.text.trim() ? [p.text.trim()] : [])).join('\n\n')
      if (text) turns[turns.length - 1].answer = text
    }
  }
  return { turns, pics }
}

/** The k-th photo of a turn (JOB-37), or nothing. */
export function turnImage(messages: ModelMessage[], turn: number, k: number): Picture | undefined {
  const got = walk(messages).pics[turn]?.[k]
  return got && { mediaType: got.mediaType, data: got.data }
}

/** What was asked and answered, a turn each (JOB-27): navi's own notes and summaries left out. */
export function exchanges(messages: ModelMessage[]): Exchange[] {
  return walk(messages).turns
}

const quote = (s: string) => s.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')

export function transcript(messages: ModelMessage[], where?: string): string {
  const out: string[] = [`# navi${where ? ` in ${where}` : ''}`]
  let tools: string[] = []
  // One heading for navi's part of a turn, however many messages it took.
  let answering = false
  const flushTools = () => {
    if (tools.length) out.push(tools.map((t) => `- ${t}`).join('\n'))
    tools = []
  }
  for (const m of messages) {
    if (m.role === 'user') {
      flushTools()
      const { prompt, names } = splitUserContent(m.content as Parameters<typeof splitUserContent>[0])
      if (prompt.startsWith(SUMMARY)) {
        out.push('## Earlier, summarised', prompt.slice(SUMMARY.length).trim())
        continue
      }
      const { notes, rest } = notesOff(prompt)
      answering = false
      for (const n of notes) out.push(quote(`navi: ${n}`))
      if (rest.trim() || names.length) out.push('## You', [rest.trim(), names.length ? `_with ${names.join(', ')}_` : ''].filter(Boolean).join('\n\n'))
    } else if (m.role === 'assistant') {
      const parts = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content
      const text = parts.flatMap((p) => (p.type === 'text' && p.text.trim() ? [p.text.trim()] : []))
      // The reply to a summary says nothing; what a message says comes before the tools it then called.
      if (text.length && !(text.join('') === 'Understood.' && out.at(-2) === '## Earlier, summarised')) {
        flushTools()
        if (!answering) out.push('## navi')
        answering = true
        out.push(text.join('\n\n'))
      }
      for (const p of parts) if (p.type === 'tool-call') tools.push(brief(p.toolName, p.input))
    }
  }
  flushTools()
  return `${out.join('\n\n')}\n`
}

/** A job's turns as Markdown (JOB-29), as a conversation is shown (SES-15). */
export function exchangesMarkdown(turns: Exchange[], title: string): string {
  const out = [`# ${title}`]
  for (const t of turns) {
    out.push('## You', [t.prompt, t.files?.length ? `_with ${t.files.join(', ')}_` : ''].filter(Boolean).join('\n\n'))
    if (t.answer) out.push('## navi', t.answer)
  }
  return `${out.join('\n\n')}\n`
}
