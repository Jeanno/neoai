import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelMessage } from 'ai'
import {
  exchanges,
  newChat,
  parseChats,
  serializeChats,
  titleFrom,
  turns,
  upsert,
  withoutThinking,
} from '../src/lib/chats.ts'

const history: ModelMessage[] = [
  { role: 'user', content: 'what is here' },
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: '1', toolName: 'list_dir', input: { path: '.' } }],
  },
  {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: '1', toolName: 'list_dir', output: { type: 'text', value: 'a' } }],
  },
  { role: 'assistant', content: 'One file, a.' },
  { role: 'user', content: [{ type: 'text', text: 'and now?' }] },
  { role: 'assistant', content: 'Still a.' },
]

test('RAY-4: chats round-trip through storage as the harness history', () => {
  const chat = { ...newChat(history), updatedAt: 5 }
  assert.deepEqual(parseChats(serializeChats([chat])), [chat])
})

test('RAY-4: chats saved before the harness, as plain messages, still open', () => {
  const raw = JSON.stringify([
    {
      id: 'old',
      title: 'Hi',
      updatedAt: 1,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    },
  ])
  const [chat] = parseChats(raw)
  assert.equal(chat.id, 'old')
  assert.deepEqual(chat.history, [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
  ])
})

test('unreadable storage is an empty list, and bad entries are dropped', () => {
  assert.deepEqual(parseChats(undefined), [])
  assert.deepEqual(parseChats('not json'), [])
  assert.deepEqual(parseChats('{}'), [])
  assert.equal(parseChats(JSON.stringify([{ id: 'x' }, null, { id: 'y', history: [] }])).length, 1)
})

test('newest first, and saving a chat replaces its older copy', () => {
  const a = { ...newChat(), id: 'a', updatedAt: 1 }
  const b = { ...newChat(), id: 'b', updatedAt: 2 }
  assert.deepEqual(
    parseChats(serializeChats([a, b])).map((c) => c.id),
    ['b', 'a'],
  )
  assert.deepEqual(
    upsert([a, b], { ...a, updatedAt: 3 }).map((c) => [c.id, c.updatedAt]),
    [
      ['a', 3],
      ['b', 2],
    ],
  )
})

test('the title is the first question, shortened', () => {
  assert.equal(titleFrom(history), 'what is here')
  assert.equal(titleFrom([]), 'New Chat')
  assert.equal(titleFrom([{ role: 'user', content: 'x'.repeat(80) }]).length, 58)
})

test('RAY-4: a chat shows as questions with their answers and tool lines, newest first', () => {
  const shown = exchanges(history)
  assert.deepEqual(
    shown.map((e) => e.question),
    ['and now?', 'what is here'],
  )
  assert.deepEqual(
    shown[1].turn.items.map((i) => i.kind),
    ['tool', 'text'],
  )
  assert.equal(shown[1].turn.final, 'One file, a.')
  assert.equal(turns(history), 2)
})

test('reasoning is not stored, and an assistant message left empty is dropped', () => {
  assert.deepEqual(
    withoutThinking([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '<think>hmm</think>A' },
      { role: 'assistant', content: '<think>only thinking' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'plan</think>' },
          { type: 'tool-call', toolCallId: '1', toolName: 'grep', input: {} },
        ],
      },
    ]),
    [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'A' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'grep', input: {} }] },
    ],
  )
})

// RAY-11: a turn that came with files shows its question and the files' names, not their text.
test('a question asked about files shows without their text', () => {
  const asked: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<file name="notes.txt">\nmilk\neggs\n</file>\n\n<image name="p.png" />\n\nDescribe these files.',
        },
        { type: 'file', mediaType: 'image/png', data: 'AAAA', filename: 'p.png' },
      ],
    },
    { role: 'assistant', content: 'A list and a picture.' },
  ]
  assert.equal(titleFrom(asked), 'Describe these files.')
  assert.deepEqual(
    exchanges(asked).map((e) => [e.question, e.attached]),
    [['Describe these files.', ['notes.txt', 'p.png']]],
  )
})
