import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'
import { budget, compact, estimateTokens, split } from '../src/compact.ts'

const user = (t: string): ModelMessage => ({ role: 'user', content: t })
const assistant = (t: string): ModelMessage => ({ role: 'assistant', content: t })
const call = (): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: '1', toolName: 'grep', input: { pattern: 'x' } }],
})
const result = (): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: '1', toolName: 'grep', output: { type: 'text', value: 'a:1:x' } }],
})

function fake(text: string | null): LanguageModelV2 {
  return {
    specificationVersion: 'v2',
    provider: 'fake',
    modelId: 'fake',
    supportedUrls: {},
    doGenerate: async () => {
      if (text === null) throw new Error('down')
      return {
        content: [{ type: 'text', text }],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      }
    },
    doStream: async () => {
      throw new Error('not streamed')
    },
  }
}

// SES-7
test('tokens are estimated at four characters each', () => {
  assert.equal(estimateTokens([user('x'.repeat(400))]), Math.ceil((400 + 30) / 4))
})

// SES-8
test('a history under 70% of the window is left alone', async () => {
  const msgs = [user('hi'), assistant('hello')]
  const out = await compact(fake('never'), msgs, { contextWindow: 8192 })
  assert.equal(out.compacted, 0)
  assert.equal(out.messages, msgs)
})

test('the system prompt counts toward the limit', async () => {
  const msgs = [user('hi'), assistant('hello'), user('more'), assistant('x'.repeat(200))]
  const out = await compact(fake('S'), msgs, { contextWindow: 100, extraTokens: 1000 })
  assert.ok(out.compacted > 0)
})

// SES-9
test('the tail starts at a user message and keeps tool calls with their results', () => {
  const msgs = [user('old'), assistant('a'), user('q'), call(), result(), assistant('done')]
  const { head, tail } = split(msgs, estimateTokens(msgs.slice(2)) + 5)
  assert.deepEqual(head, msgs.slice(0, 2))
  assert.deepEqual(tail, msgs.slice(2))
})

test('a tail that fits only a partial tool exchange is pushed back to the user message before it', () => {
  const msgs = [user('q'), call(), result(), assistant('done')]
  // Room for the last two messages only: not a user boundary, so nothing is kept.
  const { head, tail } = split(msgs, estimateTokens(msgs.slice(2)) + 5)
  assert.deepEqual(tail, [])
  assert.deepEqual(head, msgs)
})

test('the head becomes a summary pair ahead of the tail', async () => {
  const msgs = [user('old question '.repeat(50)), assistant('old answer '.repeat(50)), user('recent'), assistant('reply')]
  const out = await compact(fake('User asked X; answer was Y.'), msgs, {
    contextWindow: Math.ceil(estimateTokens(msgs) / 0.7) - 1,
  })
  assert.equal(out.compacted, 2)
  assert.equal(out.messages.length, 4)
  assert.match(String(out.messages[0].content), /Summary of the earlier conversation/)
  assert.match(String(out.messages[0].content), /User asked X/)
  assert.equal(out.messages[1].role, 'assistant')
  assert.deepEqual(out.messages.slice(2), msgs.slice(2))
})

// SES-10
test('a failed summary drops the head instead of failing', async () => {
  const msgs = [user('old '.repeat(100)), assistant('a '.repeat(100)), user('recent'), assistant('r')]
  const out = await compact(fake(null), msgs, { contextWindow: Math.ceil(estimateTokens(msgs) / 0.7) - 1 })
  assert.equal(out.compacted, 2)
  assert.deepEqual(out.messages, msgs.slice(2))
})

test('when no tail fits, the whole history becomes the summary', async () => {
  const one = [user('x'.repeat(4000)), assistant('y'.repeat(4000))]
  const out = await compact(fake('S'), one, { contextWindow: 100 })
  assert.equal(out.compacted, 2)
  assert.equal(out.messages.length, 2)
  assert.match(String(out.messages[0].content), /S$/)
})

test('budget leaves the reserve free', () => {
  assert.equal(budget(1000), 700)
})
