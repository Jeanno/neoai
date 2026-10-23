import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { listen, type ServeDeps } from '../src/serve.ts'
import type { Entry } from '../src/spec.ts'

const CHAIN: Entry[] = [
  { where: 'remote', provider: 'box', id: 'big' },
  { where: 'local', prefer: 'fast' },
]

type Backend = (body: any, signal?: AbortSignal) => Response | Promise<Response>

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
      return links[Number(/link(\d)/.exec(url)![1])]!(body, init.signal)
    }) as any,
    forget: () => forgot++,
    log: (l) => logs.push(l),
  }
  const server = await listen(CHAIN, deps, 0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, sent, logs, forgot: () => forgot, close: () => server.close() }
}

const ok = (body: any) => Response.json({ choices: [{ message: { role: 'assistant', content: `hi from ${body.model}` } }] })
const post = (base: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal })

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

// SRV-6
test('each request is logged in one line, without the prompt or the key', async () => {
  const s = await serving([() => new Response('busy', { status: 503 }), ok])
  await (await post(s.base, { messages: [{ role: 'user', content: 'secret plans' }] })).json()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(s.logs.length, 1)
  assert.match(s.logs[0], /^POST \/v1\/chat\/completions → b1 · model1 · 200 · \d+ ms$/)
  assert.doesNotMatch(s.logs.join('\n'), /secret|key\d/)
  s.close()
})

// SRV-6
test('every request is logged, whatever it was, without its query', async () => {
  const s = await serving([ok])
  await (await fetch(`${s.base}/v1/models?key=sk-123`)).text()
  await (await fetch(`${s.base}/nope`)).text()
  await new Promise((r) => setTimeout(r, 20))
  assert.match(s.logs[0], /^GET \/v1\/models → 200 · \d+ ms$/)
  assert.match(s.logs[1], /^GET \/nope → 404 · \d+ ms$/)
  s.close()
})

const SSE = (chunks: string[], end?: (c: ReadableStreamDefaultController) => void, cancel?: () => void) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk))
        end?.(c)
      },
      cancel,
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )

// SRV-3: a link that breaks mid-answer cuts that answer off, and the server goes on.
test('a stream that breaks ends its own response only', async () => {
  const s = await serving([() => SSE(['data: {"a":1}\n\n'], (c) => setTimeout(() => c.error(new TypeError('terminated')), 10))])
  const r = await post(s.base, { stream: true })
  await assert.rejects(r.text())
  const again = await fetch(`${s.base}/v1/models`)
  assert.equal(again.status, 200)
  await new Promise((r) => setTimeout(r, 20))
  assert.match(s.logs[0], /→ b0 · model0 · cut off/)
  s.close()
})

// SRV-3: an app that leaves stops the model.
test('an app that leaves mid-answer stops the link answering', async () => {
  let stopped: () => void
  const gone = new Promise<void>((r) => (stopped = r))
  const s = await serving([
    (_body, signal) => {
      signal?.addEventListener('abort', () => stopped())
      return SSE(['data: {"a":1}\n\n'], undefined, () => stopped())
    },
  ])
  const leave = new AbortController()
  const r = await post(s.base, { stream: true }, {}, leave.signal)
  const reader = r.body!.getReader()
  await reader.read()
  leave.abort()
  await gone
  s.close()
})

// SRV-3, MOD-11: a link refusing the reasoning hint navi added is asked again without it.
test('a 400 over the reasoning hint is retried without it', async () => {
  const s = await serving([
    null,
    (body) => ('reasoning_effort' in body ? Response.json({ error: { message: 'unknown field reasoning_effort' } }, { status: 400 }) : ok(body)),
  ])
  const r = await post(s.base, { messages: [] })
  assert.equal(r.status, 200)
  assert.deepEqual(s.sent.map((x) => 'reasoning_effort' in x.body), [true, false])
  s.close()
})

// SRV-8: launchd gets none of the shell's exports.
test('keys exported in the shell but not saved are named at install', async () => {
  const { keysOnlyInEnv } = await import('../src/serve.ts')
  const env = { OPENAI_API_KEY: 'sk-1', ANTHROPIC_API_KEY: 'sk-2', PATH: '/bin' }
  assert.deepEqual(keysOnlyInEnv({ keys: { anthropic: 'saved' } }, env), ['OPENAI_API_KEY'])
  assert.deepEqual(keysOnlyInEnv({}, {}), [])
})

// SRV-1: only this computer can reach it.
test('it listens on loopback only', async () => {
  const s = await serving([ok])
  assert.match(s.base, /^http:\/\/127\.0\.0\.1:\d+$/)
  s.close()
})

// SRV-4: an app that left is not answered by the next link either.
test('an app that leaves while a link fails stops the walk down the chain', async () => {
  let release: () => void
  const held = new Promise<void>((r) => (release = r))
  const s = await serving([
    async () => {
      await held
      return new Response('busy', { status: 503 })
    },
    ok,
  ])
  const leave = new AbortController()
  const asked = post(s.base, { messages: [] }, {}, leave.signal).catch(() => null)
  await new Promise((r) => setTimeout(r, 30))
  leave.abort()
  await asked
  await new Promise((r) => setTimeout(r, 30))
  release!()
  await new Promise((r) => setTimeout(r, 30))
  assert.deepEqual(s.sent.map((x) => x.url), ['http://link0/chat/completions'])
  s.close()
})
