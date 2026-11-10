import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thinkingOff } from '../src/provider.ts'

const ollama = { backend: 'ollama', baseURL: 'http://127.0.0.1:11434', native: 'ollama' } as const
const openaiish = { backend: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1' } as const
const anthropic = { backend: 'anthropic', baseURL: 'https://api.anthropic.com/v1', auth: 'k' } as const

// Measured on ollama 0.32.15 / qwen3.5:2b: reasoning_effort 'none' takes
// reasoning from 6234 chars to 0. `think: false` is ignored on this endpoint.
test('asks ollama for no reasoning when thinking is off', () => {
  assert.deepEqual(thinkingOff(ollama, false), { reasoning_effort: 'none' })
})

// navi MOD-50: thinking is on unless a caller turns it off.
test('sends nothing when thinking is left alone', () => {
  assert.deepEqual(thinkingOff(ollama, undefined), {})
  assert.deepEqual(thinkingOff(anthropic, undefined), {})
})

test('sends nothing when thinking is explicitly on', () => {
  assert.deepEqual(thinkingOff(ollama, true), {})
})

// Other OpenAI-shaped servers reject unknown fields inconsistently; only
// measured backends get the flag.
test('does not send the flag to unmeasured backends', () => {
  assert.deepEqual(thinkingOff(openaiish, false), {})
})

// The backend name is no evidence of what a server honours; being custom is (MOD-50).
test('a server is asked by being custom, not by its name', () => {
  assert.deepEqual(thinkingOff({ backend: 'darkbloom', baseURL: 'http://127.0.0.1:9000/v1', auth: 'k' }, false), {})
  assert.deepEqual(thinkingOff({ backend: 'box', baseURL: 'http://127.0.0.1:9000/v1', custom: true }, false), { reasoning_effort: 'none' })
  assert.deepEqual(thinkingOff({ backend: 'box', baseURL: 'http://127.0.0.1:9000/v1', custom: true }, undefined), {})
})

// Measured 2026-11: Anthropic's compatibility layer ignores reasoning_effort;
// Sonnet 5.5 stops thinking only for this.
test('asks Anthropic with between_tools when thinking is off', () => {
  assert.deepEqual(thinkingOff(anthropic, false), { thinking: { type: 'between_tools' } })
  // A custom endpoint someone named anthropic is still a custom endpoint.
  assert.deepEqual(thinkingOff({ backend: 'anthropic', baseURL: 'http://box/v1', custom: true }, false), { reasoning_effort: 'none' })
})

// navi MOD-50, MOD-53: a custom endpoint thinks unless asked not to, for the
// model or for one call; a refusal of the switch is asked again without it.
test('a call can turn thinking off for itself, and a refusal is asked without', async () => {
  const { createServer } = await import('node:http')
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { generateText } = await import('ai')
  const bodies: any[] = []
  let refuse = false
  const server = createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'm1' }] }))
    let raw = ''
    for await (const c of req) raw += c
    const body = JSON.parse(raw)
    bodies.push(body)
    if (refuse && body.reasoning_effort) {
      res.statusCode = 400
      return res.end('{"error":"unknown field reasoning_effort"}')
    }
    res.end(JSON.stringify({ choices: [{ message: { content: 'SAFE', reasoning_content: 'it reads' }, finish_reason: 'stop' }] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const home = await mkdtemp(join(tmpdir(), 'neorouter-think-'))
  await mkdir(join(home, '.neoai'))
  const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify({ custom: { box: { baseURL } } }))
  const realHome = process.env.HOME
  process.env.HOME = home
  process.env.NEOROUTER_QUIET = '1'
  try {
    const { auto } = await import('../src/index.ts')
    const model = auto({ provider: 'box', model: 'm1' })
    const thought = await generateText({ model, prompt: 'x' })
    assert.equal(thought.text, 'SAFE')
    // MOD-52: what it thought comes back as reasoning, apart from the answer.
    assert.equal(thought.reasoningText, 'it reads')
    await generateText({ model, prompt: 'x', providerOptions: { neorouter: { think: false } } })
    refuse = true
    await generateText({ model, prompt: 'x', providerOptions: { neorouter: { think: false } } })
    assert.deepEqual(bodies.map((b) => b.reasoning_effort), [undefined, 'none', 'none', undefined])
  } finally {
    process.env.HOME = realHome
    server.close()
  }
})
