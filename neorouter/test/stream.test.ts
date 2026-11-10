import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sseParts } from '../src/provider.ts'

/** Server-sent events, delivered in chunks that split lines anywhere. */
async function* sse(events: unknown[], cut = 7) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  for (let i = 0; i < text.length; i += cut) yield new TextEncoder().encode(text.slice(i, i + cut))
}

async function collect(body: AsyncIterable<Uint8Array>) {
  const parts = []
  for await (const p of sseParts(body)) parts.push(p)
  return parts
}

test('text arrives as deltas, then the finish', async () => {
  const parts = await collect(
    sse([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
    ]),
  )
  assert.deepEqual(
    parts.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta),
    ['Hel', 'lo'],
  )
  assert.equal(parts.at(-1)?.type, 'finish')
  assert.equal((parts.at(-1) as { finishReason: string }).finishReason, 'stop')
})

// The bug this fixes: tool calls in a stream were dropped, so a streamed agent
// turn never ran a tool.
test('tool call fragments are joined into whole calls', async () => {
  const parts = await collect(
    sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'list_dir', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]),
  )
  const calls = parts.filter((p) => p.type === 'tool-call')
  assert.deepEqual(calls, [
    { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: '{"path":"a.txt"}' },
    { type: 'tool-call', toolCallId: 'c2', toolName: 'list_dir', input: '{}' },
  ])
  assert.equal((parts.at(-1) as { finishReason: string }).finishReason, 'tool-calls')
})

test('a turn with tool calls finishes as tool-calls even when the server says stop', async () => {
  const parts = await collect(
    sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'x', arguments: '{}' } }] }, finish_reason: 'stop' }] }]),
  )
  assert.equal((parts.at(-1) as { finishReason: string }).finishReason, 'tool-calls')
})

test('usage is reported on the finish', async () => {
  const parts = await collect(
    sse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }]),
  )
  assert.deepEqual((parts.at(-1) as { usage: unknown }).usage, { inputTokens: 3, outputTokens: 1, totalTokens: 4 })
})

test('cached prompt tokens are reported too', async () => {
  const parts = await collect(
    sse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 1, total_tokens: 31, prompt_tokens_details: { cached_tokens: 20 } } }]),
  )
  assert.deepEqual((parts.at(-1) as { usage: unknown }).usage, { inputTokens: 30, outputTokens: 1, totalTokens: 31, cachedInputTokens: 20 })
})

// navi MOD-52: thinking a server streams apart from the answer is reasoning, not text.
test('reasoning_content streams as reasoning, then the answer as text', async () => {
  const parts = await collect(
    sse([
      { choices: [{ delta: { role: 'assistant' } }] },
      { choices: [{ delta: { reasoning: 'Let', reasoning_content: 'Let' } }] },
      { choices: [{ delta: { reasoning_content: ' me see' } }] },
      { choices: [{ delta: { content: '391' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 70, completion_tokens_details: { reasoning_tokens: 66 } } },
    ]),
  )
  const types = parts.map((p) => p.type)
  assert.deepEqual(types, ['text-start', 'reasoning-start', 'reasoning-delta', 'reasoning-delta', 'reasoning-end', 'text-delta', 'text-end', 'finish'])
  assert.equal(parts.filter((p) => p.type === 'reasoning-delta').map((p) => (p as { delta: string }).delta).join(''), 'Let me see')
  assert.equal(parts.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta).join(''), '391')
  // MOD-54: thinking is part of the output count, and said apart.
  assert.deepEqual((parts.at(-1) as { usage: unknown }).usage, { inputTokens: 9, outputTokens: 70, totalTokens: undefined, reasoningTokens: 66 })
})

test('thinking with no answer yet still ends its reasoning part', async () => {
  const parts = await collect(sse([{ choices: [{ delta: { reasoning_content: 'hmm' }, finish_reason: 'length' }] }]))
  assert.deepEqual(parts.map((p) => p.type), ['text-start', 'reasoning-start', 'reasoning-delta', 'reasoning-end', 'text-end', 'finish'])
})
