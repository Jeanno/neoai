import type { LanguageModelMiddleware } from 'ai'

/**
 * Thinking a model writes into its answer (MOD-26). Some servers apply a
 * chat template that opens `<think>` in the prompt, so the answer starts
 * with the thinking and a bare `</think>`; others leave the whole
 * `<think>…</think>` in. Either way it is taken out of the text at the start
 * of each step and passed on as reasoning, so no front end shows the tags.
 */

const OPEN = '<think>'
const CLOSE = '</think>'

/** A leading `<think>…</think>` or a bare `</think>` split from the answer, for a whole text. */
export function splitThink(text: string): { reasoning: string; text: string } {
  const t = text.trimStart()
  if (t.startsWith(OPEN)) {
    const end = t.indexOf(CLOSE)
    if (end < 0) return { reasoning: t.slice(OPEN.length), text: '' }
    return { reasoning: t.slice(OPEN.length, end).trim(), text: t.slice(end + CLOSE.length).trimStart() }
  }
  const end = t.indexOf(CLOSE)
  // A bare close with no open: what came before it was thinking, if it came first.
  if (end >= 0 && !t.slice(0, end).includes(OPEN)) return { reasoning: t.slice(0, end).trim(), text: t.slice(end + CLOSE.length).trimStart() }
  return { reasoning: '', text: text.replace(/^(?:[ \t]*\n)+/, '') }
}

/** How much of `s`'s end could be the start of `tag`, so is held back. */
const partial = (s: string, tag: string) => {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n
  return 0
}

type Part = { type: string; id?: string; delta?: string }

/**
 * Streamed, the start of a step's text is held only while it could still
 * be a tag (blank, or a part of `<think>` or `</think>`), so an answer is not
 * slowed. A bare close after thinking is only caught whole (`splitThink`).
 */
export const thinkTags: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate }) => {
    const got = await doGenerate()
    type Content = (typeof got.content)[number]
    const content = got.content.flatMap((c): Content[] => {
      if (c.type !== 'text') return [c]
      const { reasoning, text } = splitThink(c.text)
      return [...(reasoning ? [{ type: 'reasoning' as const, text: reasoning }] : []), ...(text || !reasoning ? [{ ...c, text }] : [])]
    })
    return { ...got, content }
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream()
    const held = new Map<string, { buf: string; mode: 'start' | 'inside' | 'lead' | 'pass' }>()
    const step = (c: TransformStreamDefaultController<Part>, id: string, end: boolean) => {
      const h = held.get(id)!
      const think = `think-${id}`
      for (;;) {
        if (h.mode === 'pass') {
          if (h.buf) c.enqueue({ type: 'text-delta', id, delta: h.buf })
          h.buf = ''
          return
        }
        if (h.mode === 'lead') {
          h.buf = h.buf.trimStart()
          if (!h.buf) return
          h.mode = 'pass'
          continue
        }
        if (h.mode === 'inside') {
          const at = h.buf.indexOf(CLOSE)
          const upTo = at >= 0 ? at : h.buf.length - (end ? 0 : partial(h.buf, CLOSE))
          if (upTo > 0) c.enqueue({ type: 'reasoning-delta', id: think, delta: h.buf.slice(0, upTo) })
          if (at < 0) {
            h.buf = h.buf.slice(upTo)
            if (end) c.enqueue({ type: 'reasoning-end', id: think })
            return
          }
          c.enqueue({ type: 'reasoning-end', id: think })
          h.buf = h.buf.slice(at + CLOSE.length)
          h.mode = 'lead'
          continue
        }
        const t = h.buf.trimStart()
        if (t.startsWith(OPEN)) {
          c.enqueue({ type: 'reasoning-start', id: think })
          h.buf = t.slice(OPEN.length)
          h.mode = 'inside'
          continue
        }
        if (t.startsWith(CLOSE)) {
          h.buf = t.slice(CLOSE.length)
          h.mode = 'lead'
          continue
        }
        if (!end && (!t || OPEN.startsWith(t) || CLOSE.startsWith(t))) return
        // Blank lines before an answer say nothing; an indented first line keeps its indent.
        h.buf = h.buf.replace(/^(?:[ \t]*\n)+/, '')
        h.mode = 'pass'
      }
    }
    return {
      ...rest,
      stream: (stream as ReadableStream<Part>).pipeThrough(
        new TransformStream<Part, Part>({
          transform(part, c) {
            if (part.type === 'text-start') {
              held.set(part.id!, { buf: '', mode: 'start' })
              c.enqueue(part)
            } else if (part.type === 'text-delta' && held.has(part.id!)) {
              held.get(part.id!)!.buf += part.delta ?? ''
              step(c, part.id!, false)
            } else if (part.type === 'text-end' && held.has(part.id!)) {
              step(c, part.id!, true)
              held.delete(part.id!)
              c.enqueue(part)
            } else c.enqueue(part)
          },
        }),
      ) as typeof stream,
    }
  },
}
