import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitThinking } from '../src/lib/think.ts'

// Qwen3 with thinking on: the template opens <think>, the output only closes it.
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
