import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simulateReadableStream } from 'ai'
import { splitThink, thinkTags } from '../src/think.ts'

type Part = { type: string; id?: string; delta?: string }

/** What the middleware lets through for a step whose text arrives in these pieces. */
async function streamed(...deltas: string[]) {
  const chunks: Part[] = [{ type: 'text-start', id: 't' }, ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })), { type: 'text-end', id: 't' }, { type: 'finish' }]
  const doStream = async () => ({ stream: simulateReadableStream({ chunks }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { stream } = await thinkTags.wrapStream!({ doStream, doGenerate: undefined, params: {}, model: undefined } as any)
  const parts: Part[] = []
  for await (const p of stream as ReadableStream<Part>) parts.push(p)
  const join = (type: string) => parts.filter((p) => p.type === type).map((p) => p.delta).join('')
  return { text: join('text-delta'), reasoning: join('reasoning-delta'), parts: parts.map((p) => p.type) }
}

// MOD-26
test('a bare close tag at the start of an answer is taken out, however it is split', async () => {
  assert.deepEqual(await streamed('</think>\n\n4'), { text: '4', reasoning: '', parts: ['text-start', 'text-delta', 'text-end', 'finish'] })
  const split = await streamed('\n</th', 'ink>', '\n', '\nHello', ' there')
  assert.equal(split.text, 'Hello there')
})

test('thinking in tags at the start goes on as reasoning, the answer as text', async () => {
  const got = await streamed('<thi', 'nk>Let me see', ' ... 2+2</', 'think>\n\n', 'Four.')
  assert.equal(got.text, 'Four.')
  assert.equal(got.reasoning, 'Let me see ... 2+2')
  assert.deepEqual(got.parts.filter((p) => p.startsWith('reasoning')).filter((p, i, a) => a.indexOf(p) === i), ['reasoning-start', 'reasoning-delta', 'reasoning-end'])
})

test('an answer without tags streams as it came, and a tag later on is left in it', async () => {
  const got = await streamed('Use ', '`</think>`', ' to close it.')
  assert.equal(got.text, 'Use `</think>` to close it.')
  // Blank lines before an answer go; an indent on its first line stays.
  assert.equal((await streamed('\n', '\n4')).text, '4')
  assert.equal((await streamed('\n    code()')).text, '    code()')
  // Something that only looked like the start of a tag is let through at the end.
  assert.equal((await streamed('<thi')).text, '<thi')
  // Thinking never closed is all reasoning.
  assert.deepEqual(await streamed('<think>hmm'), { text: '', reasoning: 'hmm', parts: ['text-start', 'reasoning-start', 'reasoning-delta', 'reasoning-end', 'text-end', 'finish'] })
})

test('a whole answer has its leading thinking split off, even before a bare close', () => {
  assert.deepEqual(splitThink('</think>\n\n4'), { reasoning: '', text: '4' })
  assert.deepEqual(splitThink('<think>a</think> b'), { reasoning: 'a', text: 'b' })
  assert.deepEqual(splitThink('weighing it up\n</think>\n\nYes.'), { reasoning: 'weighing it up', text: 'Yes.' })
  assert.deepEqual(splitThink('<think>\n\n</think>\n\nSAFE'), { reasoning: '', text: 'SAFE' })
  assert.deepEqual(splitThink('Plain.'), { reasoning: '', text: 'Plain.' })
  assert.deepEqual(splitThink('\n\nFour'), { reasoning: '', text: 'Four' })
  // A close after an open later in the text is not thinking.
  assert.deepEqual(splitThink('See <think> and </think>.'), { reasoning: '', text: 'See <think> and </think>.' })
})

test('generated answers, as the judge gets them, lose their thinking too', async () => {
  const doGenerate = async () => ({ content: [{ type: 'text', text: '<think>is it safe?</think>\nSAFE' }], finishReason: 'stop', usage: {}, warnings: [] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const got = await thinkTags.wrapGenerate!({ doGenerate, doStream: undefined, params: {}, model: undefined } as any)
  assert.deepEqual(got.content, [{ type: 'reasoning', text: 'is it safe?' }, { type: 'text', text: 'SAFE' }])
})

// MOD-52: thinking is not kept in the conversation.
test('the conversation is kept without thinking, and an answer that was only thinking goes', async () => {
  const { withoutThinking } = await import('../src/think.ts')
  const kept = withoutThinking([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'Hello.' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'only this' }] },
    { role: 'assistant', content: 'plain' },
  ])
  assert.deepEqual(kept, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] },
    { role: 'assistant', content: 'plain' },
  ])
})
