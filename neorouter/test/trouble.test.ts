import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateText } from 'ai'
import { CallError, detailOf, troubleOf } from '../src/provider.ts'

// MOD-41
test('a failed call is named by its kind of trouble', () => {
  assert.equal(troubleOf(undefined), 'unreachable')
  assert.equal(troubleOf(401, '{"error":"bad key"}'), 'key')
  assert.equal(troubleOf(403), 'key')
  assert.equal(troubleOf(402), 'credit')
  assert.equal(troubleOf(404, '{"error":{"message":"The model `x` does not exist"}}'), 'gone')
  assert.equal(troubleOf(400, 'model qwen not found'), 'gone')
  assert.equal(troubleOf(429, '{"error":{"message":"capacity","code":"queueFull"}}'), 'busy')
  assert.equal(troubleOf(429), 'busy')
  assert.equal(troubleOf(529, 'overloaded'), 'busy')
  assert.equal(troubleOf(503), 'busy')
  assert.equal(troubleOf(503, 'model not loaded yet'), 'loading')
  assert.equal(troubleOf(400, 'no model is loaded'), 'loading')
  assert.equal(troubleOf(500), 'server')
  assert.equal(troubleOf(400, 'context length exceeded'), 'request')
  assert.equal(troubleOf(422, 'bad tool schema'), 'request')
})

// MOD-41: the server's own words, short, and no URL
test('the detail is the status and what the server said, briefly', () => {
  assert.equal(detailOf(429, '{"error":{"message":"capacity","code":"queueFull"}}'), '429 capacity (queueFull)')
  assert.equal(detailOf(401, '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}'), '401 invalid x-api-key (authentication_error)')
  assert.equal(detailOf(503, 'Service   Unavailable\n'), '503 Service Unavailable')
  assert.equal(detailOf(500, ''), '500')
  assert.equal(detailOf(500, 'x'.repeat(200)).length, 84)
})

async function busyServer() {
  let chats = 0
  const server = createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'm1' }] }))
    for await (const _ of req);
    chats++
    res.statusCode = 429
    res.end('{"error":{"message":"capacity","code":"queueFull"}}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const home = await mkdtemp(join(tmpdir(), 'neorouter-trouble-'))
  await mkdir(join(home, '.neoai'))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify({ custom: { box: { baseURL } } }))
  return { server, home, chats: () => chats }
}

// MOD-41, MOD-42: a busy server's error says so; a caller can ask for fewer retries
test('a call can be tried fewer times, and fails as busy', async () => {
  const { server, home, chats } = await busyServer()
  const realHome = process.env.HOME
  process.env.HOME = home
  process.env.NEOROUTER_QUIET = '1'
  try {
    const { auto, reset } = await import('../src/index.ts')
    reset()
    const ask = (retries: number) =>
      generateText({ model: auto({ provider: 'box', model: 'm1' }), prompt: 'x', maxRetries: 0, providerOptions: { neorouter: { retries } } })
    const started = Date.now()
    const e = await ask(0).then(() => null, (e) => e)
    assert.ok(e instanceof CallError, String(e))
    assert.equal(e.trouble, 'busy')
    assert.equal(e.detail, '429 capacity (queueFull)')
    assert.equal(e.status, 429)
    assert.equal(chats(), 1)
    assert.ok(Date.now() - started < 1000)
    await ask(1).catch(() => {})
    assert.equal(chats(), 3)
  } finally {
    process.env.HOME = realHome
    server.close()
  }
})

// MOD-41: a server that stops listening after it resolved is a server not reached
test('a refused connection is unreachable', async () => {
  const { server, home } = await busyServer()
  const realHome = process.env.HOME
  process.env.HOME = home
  process.env.NEOROUTER_QUIET = '1'
  try {
    const { auto, reset, probe } = await import('../src/index.ts')
    reset()
    assert.ok(await probe({ provider: 'box', model: 'm1' }))
    await new Promise<void>((r) => server.close(() => r()))
    const e = await generateText({ model: auto({ provider: 'box', model: 'm1' }), prompt: 'x', maxRetries: 0, providerOptions: { neorouter: { retries: 0 } } }).then(
      () => null,
      (e) => e,
    )
    assert.ok(e instanceof CallError, String(e))
    assert.equal(e.trouble, 'unreachable')
    assert.equal(e.detail, 'connection refused')
  } finally {
    process.env.HOME = realHome
    server.close()
  }
})
