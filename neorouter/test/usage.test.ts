import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamText } from 'ai'

// A stream asks for its token counts; a server that refuses the field is asked again without it.
test('a stream asks for usage, and a server that refuses it is asked without', async () => {
  const bodies: any[] = []
  let refuse = true
  const server = createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'm1' }] }))
    let raw = ''
    for await (const c of req) raw += c
    const body = JSON.parse(raw)
    bodies.push(body)
    if (refuse && body.stream_options) {
      res.statusCode = 400
      return res.end('{"error":"unknown field stream_options"}')
    }
    res.setHeader('content-type', 'text/event-stream')
    const chunk = { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }], ...(body.stream_options && { usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }) }
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const home = await mkdtemp(join(tmpdir(), 'neorouter-usage-'))
  await mkdir(join(home, '.neoai'))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify({ custom: { box: { baseURL } } }))
  const realHome = process.env.HOME
  process.env.HOME = home
  process.env.NEOROUTER_QUIET = '1'
  try {
    const { auto, reset } = await import('../src/index.ts')
    const ask = async () => (await streamText({ model: auto({ provider: 'box', model: 'm1' }), prompt: 'x' }).totalUsage).inputTokens
    assert.equal(await ask(), undefined)
    assert.deepEqual(bodies.map((b) => !!b.stream_options), [true, false])
    refuse = false
    reset()
    assert.equal(await ask(), 5)
    assert.deepEqual(bodies.at(-1).stream_options, { include_usage: true })
  } finally {
    process.env.HOME = realHome
    server.close()
  }
})
