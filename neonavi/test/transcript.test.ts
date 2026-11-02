import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ModelMessage } from 'ai'
import { userContent } from '../src/attach.ts'
import { transcript } from '../src/transcript.ts'

// SES-15, SES-16
test('a saved conversation reads as Markdown: prompts, tools a line each in order, one heading per answer', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Summary of the earlier conversation:\nThey set up the repo.' },
    { role: 'assistant', content: 'Understood.' },
    { role: 'user', content: userContent('what does it say?', [{ kind: 'text', name: 'note.txt', text: 'call the plumber' }]) },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'secret thoughts' },
        { type: 'tool-call', toolCallId: 'a', toolName: 'run_shell', input: { command: 'ls -la\n  && pwd' } },
      ],
    },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'run_shell', output: { type: 'text', value: 'PRIVATE OUTPUT' } }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'It says **call the plumber**. Saving it.' },
        { type: 'tool-call', toolCallId: 'b', toolName: 'write_file', input: JSON.stringify({ path: 'todo.txt', content: 'x'.repeat(500) }) },
      ],
    },
    { role: 'assistant', content: 'Saved to todo.txt.' },
    { role: 'user', content: '(navi: the user undid your file changes: todo.txt is back as before.)\n\nnow just list it' },
    { role: 'assistant', content: 'Listed.' },
  ]
  assert.equal(
    transcript(messages, '~/work'),
    [
      '# navi in ~/work',
      '## Earlier, summarised',
      'They set up the repo.',
      '## You',
      'what does it say?\n\n_with note.txt_',
      '- run_shell: ls -la && pwd',
      '## navi',
      'It says **call the plumber**. Saving it.',
      '- write_file: todo.txt',
      'Saved to todo.txt.',
      '> navi: the user undid your file changes: todo.txt is back as before.',
      '## You',
      'now just list it',
      '## navi',
      'Listed.',
    ].join('\n\n') + '\n',
  )
})

test('a long tool input is cut short, and a message navi wrote alone is only a quote', () => {
  const got = transcript([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'browse', input: { x: 'y'.repeat(300) } }] },
    { role: 'user', content: '(navi: the model that started on this struggled.)' },
    { role: 'assistant', content: 'Done.' },
  ])
  assert.match(got, /^# navi\n/)
  assert.match(got, /- browse: \{"x":"y+…\n/)
  assert.ok(got.split('\n').every((l) => l.length <= 120))
  assert.equal(got.match(/## You/g)?.length, 1)
  assert.match(got, /> navi: the model that started on this struggled\.\n\n## navi\n\nDone\.\n$/)
})
