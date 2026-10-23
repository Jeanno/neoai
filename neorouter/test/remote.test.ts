import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkKey, chooseListed, fetchModels, modelHeaders, onThisMachine, parseModels, remoteServer, roomiestFree } from '../src/remote.ts'
import { PROVIDERS } from '../src/providers.ts'
import { localFailure } from '../src/resolve.ts'
import { customEndpoints, readKey } from '../src/config.ts'

async function dirWith(config: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'neorouter-remote-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify(config))
  return dir
}

/** A fetch that answers every request with this status and body, recording what was asked. */
function answering(status: number, body: unknown = {}) {
  const asked: { url: string; headers: Record<string, string> }[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetcher, asked }
}

const offline = (async () => {
  throw new TypeError('fetch failed')
}) as typeof fetch

// MOD-14
test('every provider named in the spec is one entry, with a key page and picks', () => {
  assert.deepEqual(
    PROVIDERS.map((p) => p.id),
    ['openai', 'anthropic', 'google', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai'],
  )
  for (const p of PROVIDERS) {
    assert.match(p.baseURL, /^https:\/\/[^/]+.*[^/]$/)
    assert.match(p.keyPage, /^https:\/\//)
    assert.ok(p.recommended.length)
  }
})

// MOD-10
test('each provider key comes from its own variable first, then the file', async () => {
  const dir = await dirWith({ keys: { anthropic: 'from-file', groq: 'g' } })
  assert.equal(await readKey('anthropic', dir, { ANTHROPIC_API_KEY: 'from-env' }), 'from-env')
  assert.equal(await readKey('google', dir, { GEMINI_API_KEY: 'gem' }), 'gem')
  assert.equal(await readKey('groq', dir, {}), 'g')
  assert.equal(await readKey('xai', dir, {}), null)
})

// MOD-7: a provider without a key is no server at all.
test('a provider server carries its key, and is absent without one', async () => {
  const dir = await dirWith({ keys: { deepseek: 'k' } })
  assert.deepEqual(await remoteServer('deepseek', dir, {}), {
    backend: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    auth: 'k',
  })
  assert.equal(await remoteServer('mistral', dir, {}), null)
})

// MOD-15
test('a custom endpoint comes from custom.<name>, its key optional', async () => {
  const dir = await dirWith({
    custom: { box: { baseURL: 'http://10.0.0.2:8000/v1/', key: 's' }, open: { baseURL: 'http://h/v1' }, broken: {} },
  })
  assert.deepEqual(await remoteServer('box', dir, {}), { backend: 'box', baseURL: 'http://10.0.0.2:8000/v1', custom: true, auth: 's' })
  assert.deepEqual(await remoteServer('open', dir, {}), { backend: 'open', baseURL: 'http://h/v1', custom: true })
  assert.equal(await remoteServer('broken', dir, {}), null)
  assert.equal(await remoteServer('nobody', dir, {}), null)
  assert.deepEqual(Object.keys(customEndpoints({ custom: 'nonsense' })), [])
})

test('model lists use Bearer, except Anthropic, which wants its own header', () => {
  assert.deepEqual(modelHeaders({ backend: 'groq', baseURL: 'x', auth: 'k' }), { authorization: 'Bearer k' })
  assert.deepEqual(modelHeaders({ backend: 'anthropic', baseURL: 'x', auth: 'k' }), {
    'x-api-key': 'k',
    'anthropic-version': '2023-06-01',
  })
  assert.deepEqual(modelHeaders({ backend: 'lmstudio', baseURL: 'x' }), {})
})

// MOD-12
test('the context window is read from whichever field the list uses', () => {
  const models = parseModels({
    data: [
      { id: 'a', context_length: 1000 },
      { id: 'b', context_window: 2000 },
      { id: 'c', max_context_length: 3000 },
      { id: 'models/gemini-x' },
    ],
  })
  assert.deepEqual(models, [
    { id: 'a', contextWindow: 1000 },
    { id: 'b', contextWindow: 2000 },
    { id: 'c', contextWindow: 3000 },
    { id: 'gemini-x' },
  ])
  assert.deepEqual(parseModels(null), [])
})

// MOD-9
test('remote picks the roomiest free model that answers in text', () => {
  const models = parseModels({
    data: [
      { id: 'audio/lyria:free', pricing: { prompt: '0', completion: '0' }, context_length: 9e6, architecture: { modality: 'text->audio' } },
      { id: 'small:free', pricing: { prompt: '0', completion: '0' }, context_length: 8192, architecture: { modality: 'text->text' } },
      { id: 'multi:free', pricing: { prompt: '0', completion: '0' }, context_length: 1e6, architecture: { modality: 'text+image->text' } },
      { id: 'paid', pricing: { prompt: '0.1', completion: '0.1' }, context_length: 2e6, architecture: { modality: 'text->text' } },
    ],
  })
  assert.deepEqual(roomiestFree(models), ['multi:free', 'small:free'])
})

// SET-6: a bad key is told apart from no network.
test('a key check says rejected for 401, 403 and 400, unreachable otherwise', async () => {
  for (const status of [400, 401, 403]) assert.equal(await checkKey('openai', 'bad', answering(status).fetcher), 'rejected')
  assert.equal(await checkKey('openai', 'k', answering(503).fetcher), 'unreachable')
  assert.equal(await checkKey('openai', 'k', offline), 'unreachable')
  assert.equal(await checkKey('openai', 'k', answering(200, { data: [] }).fetcher), 'ok')
})

// OpenRouter's model list is public, so it cannot judge a key.
test('OpenRouter keys are checked against an endpoint that needs one', async () => {
  const f = answering(200)
  await checkKey('openrouter', 'k', f.fetcher)
  assert.equal(f.asked[0].url, 'https://openrouter.ai/api/v1/key')
  const a = answering(200, { data: [] })
  await checkKey('anthropic', 'k', a.fetcher)
  assert.equal(a.asked[0].url, 'https://api.anthropic.com/v1/models?limit=1000')
  assert.equal(a.asked[0].headers['x-api-key'], 'k')
})

test('a model list says why it is missing', async () => {
  const server = { backend: 'box', baseURL: 'http://h/v1' }
  assert.deepEqual(await fetchModels(server, answering(200, { data: [{ id: 'm' }] }).fetcher), {
    ok: true,
    models: [{ id: 'm' }],
  })
  assert.equal((await fetchModels(server, answering(401).fetcher)).ok, false)
  const down = await fetchModels(server, offline)
  assert.ok(!down.ok && down.why === 'unreachable')
})

// SET-26: the caller's signal reaches the request, so a cancelled check stops.
test('a listing and a key check pass the caller signal to the request', async () => {
  const ctrl = new AbortController()
  const seen: AbortSignal[] = []
  const fetcher = (async (_url: string, init?: RequestInit) => {
    seen.push(init!.signal!)
    if (init!.signal!.aborted) throw init!.signal!.reason
    return new Response('{"data":[]}', { status: 200 })
  }) as typeof fetch
  ctrl.abort()
  const listing = await fetchModels({ backend: 'box', baseURL: 'http://h/v1' }, fetcher, ctrl.signal)
  assert.ok(!listing.ok && listing.why === 'unreachable')
  assert.equal(await checkKey('openrouter', 'k', fetcher, ctrl.signal), 'unreachable')
  assert.ok(seen.length === 2 && seen.every((s) => s.aborted))
})

// MOD-7, MOD-19: a Darkbloom provider that switched from Qwen3.8 to qwen3.6
// is still the endpoint the user chose; a provider's catalogue is not.
test('a custom endpoint that now serves one other model answers with it, naming the pin', () => {
  const only = [{ id: 'qwen3.6' }]
  assert.deepEqual(chooseListed(only, 'qwen3.8', { name: 'Darkbloom', custom: true }), { model: { id: 'qwen3.6' }, replaced: 'qwen3.8' })
  assert.deepEqual(chooseListed(only, 'qwen3.6', { name: 'Darkbloom', custom: true }), { model: { id: 'qwen3.6' } })
})

test('a gone pin still fails with several models listed, at a provider, or with none', () => {
  const two = [{ id: 'a' }, { id: 'b' }]
  assert.equal(chooseListed(two, 'gone', { name: 'homelab', custom: true }), null)
  assert.equal(chooseListed([{ id: 'claude-x' }], 'gone', { name: 'anthropic' }), null)
  assert.equal(chooseListed([], 'gone', { name: 'homelab', custom: true }), null)
  assert.equal(chooseListed([{ id: 'only' }], undefined, { name: 'homelab', custom: true }), null)
})

// MOD-20
test('an address of this computer is told from one elsewhere', () => {
  const nics = {
    lo0: [{ address: '127.0.0.1' }],
    utun4: [{ address: '100.64.0.7' }, { address: 'fd7a:115c:a1e0::7' }],
  } as any
  for (const url of ['http://127.0.0.1:8000/v1', 'http://localhost:1234/v1', 'http://[::1]:8000', 'http://100.64.0.7:8000/v1', 'http://[fd7a:115c:a1e0::7]/v1'])
    assert.equal(onThisMachine(url, nics), true, url)
  for (const url of ['http://100.64.0.8:8000/v1', 'https://api.example.com/v1', 'http://homelab.local:8000', 'not a url'])
    assert.equal(onThisMachine(url, nics), false, url)
})

// MOD-21
test('a failed local link says why', () => {
  assert.equal(localFailure('running', false, []), 'no local model server is running')
  assert.equal(localFailure('local', false, []), 'no local model server is running or installed')
  assert.equal(localFailure('local', true, [], 'qwen3-4b'), 'qwen3-4b is not installed on this computer')
  assert.equal(localFailure('local', true, [{ id: 'embed', why: 'not a chat model' }], 'embed'), 'embed is not a chat model')
  assert.equal(localFailure('local', true, [{ id: 'embed', why: 'not a chat model' }]), 'no local model is usable (not a chat model)')
})
