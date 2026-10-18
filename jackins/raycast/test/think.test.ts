import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitThinking, toMarkdown } from '../src/lib/think.ts'

// Darkbloom / Qwen3.8 with thinking on: the template opens <think>, the output only closes it.
test('splits reasoning that has only a closing tag', () => {
  assert.deepEqual(splitThinking('We need to greet.\n</think>\n\nHi there friend'), {
    reasoning: 'We need to greet.',
    answer: 'Hi there friend',
  })
})

test('splits reasoning wrapped in both tags', () => {
  assert.deepEqual(splitThinking('<think>plan</think>answer'), { reasoning: 'plan', answer: 'answer' })
})

test('treats an unclosed opening tag as reasoning still in progress', () => {
  assert.deepEqual(splitThinking('<think>still going'), { reasoning: 'still going', answer: '' })
})

test('leaves plain answers alone', () => {
  assert.deepEqual(splitThinking('Hello there friend'), { reasoning: '', answer: 'Hello there friend' })
})

test('hides reasoning unless asked, and says it is thinking meanwhile', () => {
  assert.equal(toMarkdown('<think>plan', true, false), '_Thinking…_')
  assert.equal(toMarkdown('plan</think>answer', false, false), 'answer')
  assert.equal(toMarkdown('plan</think>answer', false, true), '> plan\n\nanswer')
})

test('shows an ellipsis before anything arrives', () => {
  assert.equal(toMarkdown('', true, false), '…')
})
