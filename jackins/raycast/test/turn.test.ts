import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelMessage } from 'ai'
import type { HarnessEvent } from 'neonavi/harness'
import {
  answerOf,
  applyEvent,
  emptyTurn,
  fence,
  toolLine,
  turnFromHistory,
  turnMarkdown,
  type Turn,
} from '../src/lib/turn.ts'

const fold = (events: HarnessEvent[]): Turn => events.reduce(applyEvent, emptyTurn())
const md = (t: Turn, o: Partial<Parameters<typeof turnMarkdown>[1]> = {}) =>
  turnMarkdown(t, { streaming: false, showReasoning: false, ...o })

test('RAY-2: a tool call is one short line of its name and arguments', () => {
  assert.equal(toolLine('read_file', { path: 'src/a.ts' }), 'read_file src/a.ts')
  assert.equal(toolLine('grep', { pattern: 'TODO', path: '.' }), 'grep TODO, .')
  assert.equal(toolLine('list_dir', {}), 'list_dir')
  assert.equal(toolLine('run_shell', { command: 'echo ' + 'x'.repeat(100) }).length, 'run_shell '.length + 60)
  assert.equal(toolLine('run_shell', { command: 'ls\n  -la' }), 'run_shell ls -la')
})

test('RAY-2: tool lines show while running, above the text that follows, and stay when done', () => {
  const running = fold([
    { type: 'text', text: 'Let me look.' },
    { type: 'tool-call', id: '1', name: 'list_dir', input: { path: '.' } },
  ])
  assert.equal(md(running, { streaming: true }), 'Let me look.\n\n- `list_dir .` …')

  const done = fold([
    { type: 'text', text: 'Let me look.' },
    { type: 'tool-call', id: '1', name: 'list_dir', input: { path: '.' } },
    { type: 'tool-result', id: '1', name: 'list_dir', output: 'a\nb', error: false },
    { type: 'text', text: 'Two files.' },
    { type: 'done', history: [], text: 'Two files.', empty: false, stopped: false },
  ])
  assert.equal(md(done), 'Let me look.\n\n- `list_dir .`\n\nTwo files.')
  assert.equal(answerOf(done), 'Two files.')
})

test('RAY-2: failed, judged-safe and compacted steps are marked', () => {
  const t = fold([
    { type: 'compacted', messages: 12 },
    { type: 'tool-call', id: '1', name: 'run_shell', input: { command: 'ls' } },
    { type: 'auto-approved', command: 'ls' },
    { type: 'tool-result', id: '1', name: 'run_shell', output: '', error: false },
    { type: 'tool-call', id: '2', name: 'read_file', input: { path: 'nope' } },
    { type: 'tool-result', id: '2', name: 'read_file', output: 'ENOENT', error: true },
  ])
  assert.equal(
    md(t),
    '- _compacted 12 earlier messages_\n- `run_shell ls` — approved automatically\n- `read_file nope` — failed',
  )
})

test('RAY-2: backticks in arguments cannot break out of the code span', () => {
  const t = fold([{ type: 'tool-call', id: '1', name: 'run_shell', input: { command: 'echo `date`' } }])
  assert.equal(md(t, { streaming: true }), "- `run_shell echo 'date'` …")
})

test('RAY-3: the command awaiting approval comes last, fenced', () => {
  const t = fold([{ type: 'tool-call', id: '1', name: 'run_shell', input: { command: 'rm x' } }])
  const out = md(t, { streaming: true, approval: { command: 'rm x' } })
  assert.ok(out.endsWith('**Run this command?**\n\n```sh\nrm x\n```\n\nnavi wants to run it in ~/.navi-raycast.'))
  assert.equal(fence('a ``` b', 'sh'), '````sh\na ``` b\n````')
})

test('stopping marks a call that never finished as failed, and says it stopped', () => {
  const t = fold([
    { type: 'tool-call', id: '1', name: 'run_shell', input: { command: 'make' } },
    { type: 'done', history: [], text: '', empty: true, stopped: true },
  ])
  assert.equal(md(t), '- `run_shell make` — failed\n\n_Stopped._')
})

test('errors are shown under the answer', () => {
  const t = fold([{ type: 'error', error: new Error('neorouter: server went away') }])
  assert.deepEqual(t.errors, ['server went away'])
  assert.equal(md(t), '**Error:** server went away')
})

test('reasoning is hidden unless asked for, and the copied answer never has it', () => {
  const t = fold([
    { type: 'text', text: '<think>plan</think>Hi' },
    { type: 'done', history: [], text: '<think>plan</think>Hi', empty: false, stopped: false },
  ])
  assert.equal(md(t), 'Hi')
  assert.equal(md(t, { showReasoning: true }), '> plan\n\nHi')
  assert.equal(answerOf(t), 'Hi')
  assert.equal(md(fold([{ type: 'text', text: '<think>still going' }]), { streaming: true }), '_Thinking…_')
})

test('nothing yet is an ellipsis', () => {
  assert.equal(md(emptyTurn(), { streaming: true }), '…')
})

test('RAY-4: a stored turn is redrawn from history with its tool lines', () => {
  const history: ModelMessage[] = [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking.' },
        { type: 'tool-call', toolCallId: 'a', toolName: 'read_file', input: { path: 'x' } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'a', toolName: 'read_file', output: { type: 'error-text', value: 'no' } },
      ],
    },
    { role: 'assistant', content: 'It is missing.' },
  ]
  const t = turnFromHistory(history)
  assert.equal(md(t), 'Looking.\n\n- `read_file x` — failed\n\nIt is missing.')
  assert.equal(answerOf(t), 'It is missing.')
})
