import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { listen, type ServeDeps } from '../src/serve.ts'
import type { Entry } from '../src/spec.ts'

const CHAIN: Entry[] = [
  { where: 'remote', provider: 'box', id: 'big' },
  { where: 'local', prefer: 'fast' },
]

type Backend = (body: any) => Response | Promise<Response>

/** A server over fake links: `links[i]` answers for chain[i], or is null when it resolves to nothing. */
async function serving(links: (Backend | null)[]) {
  const sent: { url: string; body: any; headers: any }[] = []
  const logs: string[] = []
  let forgot = 0
  const deps: ServeDeps = {
    route: async (entry) => {
      const i = CHAIN.indexOf(entry)
      return links[i]
        ? { url: `http://link${i}/chat/completions`, headers: { authorization: `Bearer key${i}` }, model: `model${i}`, backend: `b${i}`, local: i === 1, extra: i === 1 ? { reasoning_effort: 'none' } : {} }
        : null
    },
    why: async (entry) => `link ${CHAIN.indexOf(entry)} is not there`,
    fetch: (async (url: string, init: any) => {
      const body = JSON.parse(init.body)
      sent.push({ url, body, headers: init.headers })
      return links[Number(/link(\d)/.exec(url)![1])]!(body)
    }) as any,
    forget: () => forgot++,
    log: (l) => logs.push(l),
  }
  const server = await listen(CHAIN, deps, 0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, sent, logs, forgot: () => forgot, close: () => server.close() }
}

const ok = (body: any) => Response.json({ choices: [{ message: { role: 'assistant', content: `hi from ${body.model}` } }] })
const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

// SRV-2
test('lists one model, navi', async () => {
  const s = await serving([ok])
  const r = await fetch(`${s.base}/v1/models`)
  assert.deepEqual((await r.json()).data.map((m: any) => m.id), ['navi'])
  s.close()
})

// SRV-3
test('passes the request through with the model replaced', async () => {
  const s = await serving([ok])
  const r = await post(s.base, { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }], temperature: 0.2 })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).choices[0].message.content, 'hi from model0')
  assert.deepEqual(s.sent[0].body, { model: 'model0', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }], temperature: 0.2 })
  assert.equal(s.sent[0].headers.authorization, 'Bearer key0')
  s.close()
})

// SRV-3: a stream is passed back as it comes.
test('streams pass through unchanged', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n\n'
  const s = await serving([() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } })])
  const r = await post(s.base, { model: 'x', stream: true, messages: [] })
  assert.equal(r.headers.get('content-type'), 'text/event-stream')
  assert.equal(await r.text(), sse)
  s.close()
})

// SRV-4, MOD-11
test('a link that is busy or down falls to the next, which adds what navi would', async () => {
  const s = await serving([() => new Response('busy', { status: 503 }), ok])
  const r = await post(s.base, { model: 'x', messages: [] })
  assert.equal((await r.json()).choices[0].message.content, 'hi from model1')
  assert.deepEqual(s.sent[1].body, { reasoning_effort: 'none', model: 'model1', messages: [] })
  assert.match(s.logs.at(-1)!, /→ b1 · model1 · 200/)
  s.close()
})

test("the request's own fields win over what navi would add", async () => {
  const s = await serving([null, ok])
  await post(s.base, { model: 'x', messages: [], reasoning_effort: 'high' })
  assert.equal(s.sent[0].body.reasoning_effort, 'high')
  s.close()
})

// SRV-4, MOD-21
test('when nothing answers, a 503 lists each link and why', async () => {
  const s = await serving([
    () => {
      throw new TypeError('fetch failed')
    },
    null,
  ])
  const r = await post(s.base, { model: 'x', messages: [] })
  assert.equal(r.status, 503)
  assert.equal(
    (await r.json()).error.message,
    "No model in navi's chain answered: primary (box:big): could not be reached; fallback (local): link 1 is not there.",
  )
  assert.ok(s.forgot() >= 1)
  s.close()
})

// SRV-5
test('a request from a web page is refused', async () => {
  const s = await serving([ok])
  const r = await post(s.base, { messages: [] }, { origin: 'https://evil.example' })
  assert.equal(r.status, 403)
  assert.equal(s.sent.length, 0)
  s.close()
})

// SRV-7
test('anything else is a 404, and a body that is not JSON a 400', async () => {
  const s = await serving([ok])
  assert.equal((await fetch(`${s.base}/v1/embeddings`, { method: 'POST' })).status, 404)
  const bad = await fetch(`${s.base}/v1/chat/completions`, { method: 'POST', body: 'nope' })
  assert.equal(bad.status, 400)
  s.close()
})

// SRV-8
test('the LaunchAgent runs navi serve on its port, kept alive, logging to one file', async () => {
  const { agentPlist, AGENT } = await import('../src/serve.ts')
  const plist = agentPlist('/Users/me/.local/bin/navi', 9000, '/Users/me/Library/Logs/navi-serve.log', '/usr/bin:/a&b')
  assert.match(plist, new RegExp(`<string>${AGENT}</string>`))
  assert.match(plist, /<string>\/Users\/me\/\.local\/bin\/navi<\/string>\s*<string>serve<\/string>\s*<string>--port<\/string>\s*<string>9000<\/string>/)
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(plist, /<string>\/usr\/bin:\/a&amp;b<\/string>/)
})
