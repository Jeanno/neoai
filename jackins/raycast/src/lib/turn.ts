import type { ModelMessage } from 'ai'
import { splitUserContent, type HarnessEvent } from 'neonavi/harness'
import { splitThinking } from './think'
import type { Approval } from './approval'

/**
 * One answer as the views draw it: the harness's events folded into text and
 * tool lines, in the order they happened, so each tool call shows above the
 * text that followed it and stays there once the answer is done (RAY-2).
 */

export type Item =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; line: string; state: 'running' | 'done' | 'failed'; auto?: boolean }
  | { kind: 'note'; line: string }

export interface Turn {
  items: Item[]
  errors: string[]
  /** The final step's answer, once the turn is over. */
  final?: string
  stopped?: boolean
}

export const emptyTurn = (): Turn => ({ items: [], errors: [] })

const MAX_PART = 60

const clip = (s: string, n = MAX_PART) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** A tool call in one short line: its name and the values it was given. */
export function toolLine(name: string, input: unknown): string {
  const values =
    input && typeof input === 'object'
      ? Object.values(input as Record<string, unknown>).filter(
          (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
        )
      : input === undefined || input === null
        ? []
        : [input]
  const args = values.map((v) => clip(String(v))).join(', ')
  return args ? `${name} ${args}` : name
}

/** The turn with one more event folded in. Never changes the turn it is given. */
export function applyEvent(turn: Turn, e: HarnessEvent): Turn {
  const items = [...turn.items]
  switch (e.type) {
    case 'text': {
      if (!e.text) return turn
      const last = items.at(-1)
      if (last?.kind === 'text') items[items.length - 1] = { kind: 'text', text: last.text + e.text }
      else items.push({ kind: 'text', text: e.text })
      return { ...turn, items }
    }
    case 'tool-call':
      items.push({ kind: 'tool', id: e.id, line: toolLine(e.name, e.input), state: 'running' })
      return { ...turn, items }
    case 'auto-approved': {
      // The event names the command, not the call: mark the latest shell call still running.
      const tool = e.change ? /^(write_file|edit_file)/ : /^run_shell/
      const at = items.findLastIndex((i) => i.kind === 'tool' && i.state === 'running' && tool.test(i.line))
      if (at >= 0) items[at] = { ...(items[at] as Extract<Item, { kind: 'tool' }>), auto: true }
      return { ...turn, items }
    }
    case 'tool-result': {
      const at = items.findIndex((i) => i.kind === 'tool' && i.id === e.id)
      if (at >= 0) items[at] = { ...(items[at] as Extract<Item, { kind: 'tool' }>), state: e.error ? 'failed' : 'done' }
      return { ...turn, items }
    }
    case 'compacted':
      items.push({ kind: 'note', line: `compacted ${e.messages} earlier messages` })
      return { ...turn, items }
    case 'error':
      return {
        ...turn,
        errors: [
          ...turn.errors,
          e.error instanceof Error ? e.error.message.replace(/^neorouter: /, '') : String(e.error),
        ],
      }
    case 'done':
      return {
        ...turn,
        // A call cut short by stopping never got its result.
        items: items.map((i) => (i.kind === 'tool' && i.state === 'running' ? { ...i, state: 'failed' } : i)),
        final: e.text,
        stopped: e.stopped,
      }
  }
}

/** The answer to copy or paste: the final step's text without reasoning. */
export function answerOf(turn: Turn): string {
  if (turn.final !== undefined) return splitThinking(turn.final).answer.trim()
  const last = turn.items.at(-1)
  return last?.kind === 'text' ? splitThinking(last.text).answer.trim() : ''
}

/** A code block whose fence the text cannot close early. */
export function fence(text: string, lang = ''): string {
  let ticks = '```'
  while (text.includes(ticks)) ticks += '`'
  return `${ticks}${lang}\n${text}\n${ticks}`
}

const code = (s: string) => `\`${s.replace(/`/g, "'")}\``

function toolMarkdown(i: Extract<Item, { kind: 'tool' }>): string {
  const state = i.state === 'running' ? ' …' : i.state === 'failed' ? ' — failed' : ''
  return `- ${code(i.line)}${i.auto ? ' — approved automatically' : ''}${state}`
}

/**
 * The turn as Raycast markdown: tool lines as a short list, text as it came,
 * reasoning quoted only when asked for, and the command awaiting approval
 * last (RAY-3).
 */
export function turnMarkdown(
  turn: Turn,
  o: { streaming: boolean; showReasoning: boolean; approval?: Pick<Approval, 'command' | 'change'> | null },
): string {
  const blocks: string[] = []
  let tools: string[] = []
  const flush = () => {
    if (tools.length) blocks.push(tools.join('\n'))
    tools = []
  }
  turn.items.forEach((item, n) => {
    if (item.kind === 'tool') return tools.push(toolMarkdown(item))
    if (item.kind === 'note') return tools.push(`- _${item.line}_`)
    flush()
    const { reasoning, answer } = splitThinking(item.text)
    if (reasoning && o.showReasoning) blocks.push(reasoning.replace(/^/gm, '> '))
    if (answer) blocks.push(answer)
    else if (reasoning && o.streaming && n === turn.items.length - 1) blocks.push('_Thinking…_')
  })
  flush()
  if (turn.errors.length) blocks.push(turn.errors.map((e) => `**Error:** ${e}`).join('\n\n'))
  if (turn.stopped) blocks.push('_Stopped._')
  if (o.approval?.change)
    blocks.push(`**${capitalized(o.approval.command)}?**\n\n${fence(o.approval.change.diff, 'diff')}`)
  else if (o.approval)
    blocks.push(
      `**Run this command?**\n\n${fence(o.approval.command, 'sh')}\n\nnavi wants to run it in ~/.navi-raycast.`,
    )
  return blocks.join('\n\n') || '…'
}

const capitalized = (s: string) => s[0].toUpperCase() + s.slice(1)

/** What a user message asked, without the text of any files that came with it, and those files' names (RAY-11). */
export function userText(m: ModelMessage): { prompt: string; names: string[] } {
  return splitUserContent(m.content as Parameters<typeof splitUserContent>[0])
}

/**
 * A stored turn redrawn from history: the assistant's text and tool calls in
 * order, with calls whose result was an error marked as failed (RAY-2, RAY-4).
 */
export function turnFromHistory(messages: ModelMessage[]): Turn {
  let turn = emptyTurn()
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (typeof m.content === 'string') turn = applyEvent(turn, { type: 'text', text: m.content })
      else
        for (const p of m.content) {
          if (p.type === 'text') turn = applyEvent(turn, { type: 'text', text: p.text })
          else if (p.type === 'tool-call')
            turn = applyEvent(turn, { type: 'tool-call', id: p.toolCallId, name: p.toolName, input: p.input })
        }
    } else if (m.role === 'tool') {
      for (const p of m.content) {
        if (p.type !== 'tool-result') continue
        const error = p.output.type === 'error-text' || p.output.type === 'error-json'
        turn = applyEvent(turn, { type: 'tool-result', id: p.toolCallId, name: p.toolName, output: p.output, error })
      }
    }
  }
  const last = turn.items.at(-1)
  return { ...turn, final: last?.kind === 'text' ? last.text : '' }
}
