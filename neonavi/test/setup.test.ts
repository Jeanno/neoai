import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { CLI_NEXT_STEP, runSetup, type SetupDeps } from '../src/setup.ts'
import {
  describe,
  labelFor,
  links,
  loadConfig,
  modelLabel,
  NEXT_STEP,
  realDeps,
  saveConfig,
  setSlotIn,
  setupCore,
  type CoreDeps,
} from '../src/setup-core.ts'
import { makeLine } from '../src/approve.ts'
import { optionsFor, type Chosen, type Entry } from '../src/spec.ts'
import type { Verdict } from 'neorouter'

/** A scripted answer: literal text, or computed from what has been printed so far. */
type Answer = string | null | ((out: string) => string)

/** The number of the most recently printed row with this label. */
const row = (label: string) => (out: string) => {
  const hits = [...out.matchAll(/^\s+(\d+)  (.*)$/gm)].filter((m) => m[2].startsWith(label))
  assert.ok(hits.length, `no row "${label}" in:\n${out}`)
  return hits.at(-1)![1]
}

/** What each provider lists. */
const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-old-1'],
  openrouter: ['deepseek/deepseek-v4.1-flash', 'some/free-model'],
  groq: ['openai/gpt-oss-120b'],
}

interface World {
  config?: Record<string, any>
  /** Models on the local servers; `localUp` replaces it on each local recheck. */
  local?: string[]
  localUp?: string[][]
  /** Models on an installed runtime that is not running: found only by a resolve that may launch. */
  idle?: string[]
  key?: Verdict
  env?: Record<string, string>
  /** Base URLs that answer a model list, with what they list. */
  endpoints?: Record<string, string[]>
  /** The test question fails with this. */
  askError?: string
}

/** A fake world behind the real core, and a scripted user in front of the CLI. */
function fake(answers: Answer[], w: World = {}) {
  const out: string[] = []
  const saved: Record<string, any>[] = []
  /** Each resolve, and whether it was allowed to launch. */
  const resolves: boolean[] = []
  let config = structuredClone(w.config ?? {})
  let local = w.local ?? []
  const localUp = [...(w.localUp ?? [])]
  const env = w.env ?? {}
  const next = async () => {
    const a = answers.length ? answers.shift()! : null
    return typeof a === 'function' ? a(out.join('\n')) : a
  }
  const hasKey = (p: string) => !!config.keys?.[p] || Object.keys(env).some((k) => k.startsWith(p.toUpperCase()))
  const listFor = (name: string): string[] | null => {
    const c = config.custom?.[name]
    if (c) return w.endpoints?.[c.baseURL] ?? null
    return hasKey(name) ? (MODELS[name] ?? []) : null
  }
  const resolveLink = (e: Entry, launch: boolean): Omit<Chosen, 'index'> | null => {
    const base = { entry: e, options: optionsFor(e), contextWindow: 8192 }
    if (e.where === 'local') {
      if (launch && w.idle && !local.length) local = w.idle
      const id = e.id ?? local[0]
      return id && local.includes(id) ? { ...base, backend: 'lmstudio', modelId: id, local: true } : null
    }
    const list = listFor(e.provider!)
    const id = e.id ?? (e.provider === 'openrouter' ? 'some/free-model' : undefined)
    return list && id && list.includes(id) ? { ...base, backend: e.provider!, modelId: id, local: false } : null
  }
  const deps: CoreDeps = {
    load: async () => structuredClone(config),
    save: async (c) => {
      config = structuredClone(c)
      saved.push(structuredClone(c))
    },
    env,
    resolve: async (chain, { launch }) => {
      resolves.push(launch)
      for (const [index, e] of chain.entries()) {
        const got = resolveLink(e, launch)
        if (got) return { ...got, index }
      }
      return null
    },
    localModels: async () => local.map((id) => ({ backend: 'lmstudio', id })),
    checkKey: async () => w.key ?? 'ok',
    fetchModels: async (server) => {
      const known = MODELS[server.backend]
      const listed = known && !config.custom?.[server.backend] ? known : w.endpoints?.[server.baseURL]
      if (!listed) return { ok: false, why: 'unreachable', message: `could not reach ${server.baseURL}` }
      if (server.auth === 'wrong') return { ok: false, why: 'rejected', message: `${server.baseURL} answered 401` }
      return { ok: true, models: listed.map((id) => ({ id })) }
    },
    ask: async () => {
      if (w.askError) throw new Error(w.askError)
      return 'Hello there!'
    },
  }
  const core = setupCore(deps)
  // Rechecking for a local model is when a server can appear.
  const recheck = core.recheckLocal
  core.recheckLocal = async () => {
    if (localUp.length) local = localUp.shift()!
    return recheck()
  }
  const d: SetupDeps = { ask: next, askSecret: next, print: (s) => out.push(s), core }
  return { d, core, out: () => out.join('\n'), saved, config: () => config, resolves }
}

const KEYED = { keys: { anthropic: 'k' } }

// SET-1, SET-13, MOD-17
test('an empty config shows the local model as primary and no fallback', async () => {
  const f = fake([''], { local: ['qwen3-4b'] })
  assert.equal(await runSetup(f.d), 0)
  assert.match(f.out(), /Primary\s+any local model \(fastest\)/)
  assert.match(f.out(), /Fallback\s+none/)
  assert.match(f.out(), /qwen3-4b, the primary \(on this computer\)/)
  assert.equal(f.saved.length, 0)
})

test('says when the answer is remote, and which slot answers', async () => {
  const f = fake([''], { config: { ...KEYED, model: ['local', 'anthropic:claude-sonnet-5-5'] } })
  await runSetup(f.d)
  assert.match(f.out(), /Fallback\s+claude-sonnet-5-5 on Anthropic/)
  // SET-25: model first.
  assert.match(f.out(), /claude-sonnet-5-5 on Anthropic, the fallback \(REMOTE/)
})

test('reports when nothing answers', async () => {
  const f = fake([''])
  assert.equal(await runSetup(f.d), 1)
  assert.match(f.out(), /can't find a running model/)
})

test('shows links after the fallback', async () => {
  const f = fake([''], { config: { model: ['local', 'best', 'x/y'] } })
  await runSetup(f.d)
  assert.match(f.out(), /Then\s+x\/y on OpenRouter/)
})

// SET-2
test('--check exits 0 when a model answers and asks nothing', async () => {
  const f = fake(['1'], { local: ['qwen3-4b'] })
  assert.equal(await runSetup(f.d, { check: true }), 0)
  assert.doesNotMatch(f.out(), /Primary/)
})

test('--check exits 1 with the next step when nothing answers', async () => {
  const f = fake(['1'])
  assert.equal(await runSetup(f.d, { check: true }), 1)
  assert.match(f.out(), /navi setup/)
  assert.ok(f.out().includes(CLI_NEXT_STEP))
  assert.equal(f.saved.length, 0)
})

// SET-27: the core's own next step names no command.
test('the core words the next step without naming a command', () => {
  assert.doesNotMatch(NEXT_STEP, /navi setup|`/)
  assert.ok(CLI_NEXT_STEP.startsWith(NEXT_STEP))
  assert.match(CLI_NEXT_STEP, /run `navi setup`/)
})

// SET-24, MOD-18
test('opening setup starts no runtime; picking a model or --check may', async () => {
  const f = fake([''], { idle: ['qwen3-4b'] })
  assert.equal(await runSetup(f.d), 1)
  assert.deepEqual(f.resolves, [false])
  assert.match(f.out(), /can't find a running model/)

  const g = fake(['1'], { idle: ['qwen3-4b'] })
  assert.equal(await runSetup(g.d, { check: true }), 0)
  assert.deepEqual(g.resolves, [true])

  const h = fake(['1', row('Local'), row('any local model'), ''], { idle: ['qwen3-4b'] })
  assert.equal(await runSetup(h.d), 0)
  assert.deepEqual(h.resolves, [false, true])
  assert.match(h.out(), /qwen3-4b, the primary/)
})

// SET-18
test('a slot offers Providers, Local and Custom; the fallback also none', async () => {
  const f = fake(['1', '', '2', ''])
  await runSetup(f.d)
  const [primary, fallback] = f.out().split('Choose the fallback')
  assert.match(primary, /Providers[\s\S]*Local[\s\S]*Custom/)
  assert.doesNotMatch(primary, /\d+  none/)
  assert.match(fallback, /\d+  none/)
})

test('the fallback can be none, and never lists the primary', async () => {
  const f = fake(['2', row('Local'), ''], { config: { model: ['local:a', 'local'] }, local: ['a', 'b'] })
  await runSetup(f.d)
  const listing = f.out().slice(f.out().lastIndexOf('On this computer'))
  assert.doesNotMatch(listing, /\d+  a\b/)
  assert.match(listing, /\d+  b/)

  const g = fake(['2', row('none'), ''], { config: { model: ['local:a', 'local'] }, local: ['a'] })
  assert.equal(await runSetup(g.d), 0)
  assert.deepEqual(g.saved.at(-1)?.model, ['local:a'])
})

// SET-21, SET-17, SET-11
test('a local model becomes the primary, saved with local:, and is asked a question', async () => {
  const f = fake(['1', row('Local'), row('qwen/qwen3-8b'), ''], { local: ['qwen3-4b', 'qwen/qwen3-8b'] })
  assert.equal(await runSetup(f.d), 0)
  assert.deepEqual(f.saved.at(-1)?.model, ['local:qwen/qwen3-8b'])
  // SET-25: listed and named by the model, never the server's app.
  assert.match(f.out(), /\d+  qwen\/qwen3-8b$/m)
  assert.match(f.out(), /qwen\/qwen3-8b, the primary/)
  assert.doesNotMatch(f.out(), /lmstudio ·|  lmstudio/)
  assert.match(f.out(), /Hello there!/)
})

test('the current pick is marked', async () => {
  const f = fake(['1', row('Local'), '', '', ''], { config: { model: ['local:a'] }, local: ['a', 'b'] })
  await runSetup(f.d)
  assert.match(f.out(), /\d+  a.*\(current\)/)
})

// SET-11
test('a test question that fails shows the error', async () => {
  const f = fake(['1', row('Local'), row('a'), ''], { local: ['a'], askError: 'it timed out' })
  await runSetup(f.d)
  assert.match(f.out(), /The model didn't answer: it timed out/)
})

// SET-5
test('local help checks again until a model is found, then lists it', async () => {
  const f = fake(['1', row('Local'), row('Help getting a model'), '', '', row('qwen3-4b'), ''], {
    localUp: [[], ['qwen3-4b']],
  })
  assert.equal(await runSetup(f.d), 0)
  assert.match(f.out(), /lmstudio\.ai/)
  assert.match(f.out(), /ollama\.com/)
  assert.match(f.out(), /Nothing yet/)
  assert.match(f.out(), /Found qwen3-4b\./)
  assert.deepEqual(f.saved.at(-1)?.model, ['local:qwen3-4b'])
})

test('going back from local help saves nothing', async () => {
  const f = fake(['1', row('Local'), row('Help getting a model'), 'b', '', '', ''])
  assert.equal(await runSetup(f.d), 1)
  assert.equal(f.saved.length, 0)
})

// SET-19
test('providers are listed by name, marking those with a key', async () => {
  const f = fake(['1', row('Providers'), '', '', ''], { config: KEYED, env: { GROQ_API_KEY: 'g' } })
  await runSetup(f.d)
  for (const name of ['OpenAI', 'Anthropic', 'Google Gemini', 'OpenRouter', 'Groq', 'DeepSeek', 'Mistral', 'xAI'])
    assert.match(f.out(), new RegExp(`\\d+  ${name}`))
  assert.match(f.out(), /Anthropic  key saved/)
  assert.match(f.out(), /Groq  key from GROQ_API_KEY/)
  assert.doesNotMatch(f.out(), /OpenAI  key/)
})

// SET-6, SET-20
test('a provider without a key asks for one, checks it, saves it, then lists models', async () => {
  const f = fake(['1', row('Providers'), row('Anthropic'), 'sk-ant-good', row('claude-haiku-5-5'), ''])
  assert.equal(await runSetup(f.d), 0)
  assert.match(f.out(), /platform\.claude\.com\/settings\/keys/)
  assert.equal(f.saved[0].keys.anthropic, 'sk-ant-good')
  assert.deepEqual(f.saved.at(-1)?.model, ['anthropic:claude-haiku-5-5'])
  assert.match(f.out(), /REMOTE/)
})

test('a rejected key is not saved', async () => {
  const f = fake(['1', row('Providers'), row('OpenRouter'), 'sk-or-bad', '', '', ''], { key: 'rejected' })
  assert.equal(await runSetup(f.d), 1)
  assert.equal(f.saved.length, 0)
  assert.match(f.out(), /OpenRouter didn't accept that key\. Nothing was saved/)
})

test('a key that cannot be checked is not saved, and setup says why', async () => {
  const f = fake(['1', row('Providers'), row('OpenRouter'), 'sk-or-maybe', '', '', ''], { key: 'unreachable' })
  assert.equal(await runSetup(f.d), 1)
  assert.equal(f.saved.length, 0)
  assert.match(f.out(), /Couldn't reach OpenRouter/)
})

test('a provider with a key can have it replaced', async () => {
  const f = fake(['1', row('Providers'), row('Anthropic'), row('Replace the key'), 'sk-ant-new', '', '', '', ''], {
    config: KEYED,
  })
  await runSetup(f.d)
  assert.equal(f.saved.at(-1)?.keys.anthropic, 'sk-ant-new')
})

// SET-20
test('hand-picked models the provider still offers come first, then all models', async () => {
  const f = fake(['1', row('Providers'), row('Anthropic'), row('All models…'), row('claude-old-1'), ''], { config: KEYED })
  assert.equal(await runSetup(f.d), 0)
  const picks = f.out().slice(f.out().indexOf('Anthropic:'), f.out().indexOf('All Anthropic models:'))
  assert.match(picks, /claude-sonnet-5-5/)
  // In the code's list but not the provider's: not shown.
  assert.doesNotMatch(picks, /claude-opus-5-5|claude-old-1/)
  assert.deepEqual(f.saved.at(-1)?.model, ['anthropic:claude-old-1'])
})

// SET-22, MOD-15
test('a custom endpoint is checked, saved under custom.<name>, and its models listed', async () => {
  const f = fake(
    ['2', row('Custom'), row('Add an endpoint'), 'homelab', 'http://box:8000/', '', row('qwen3-27b'), ''],
    { local: ['a'], endpoints: { 'http://box:8000/v1': ['qwen3-27b'] } },
  )
  assert.equal(await runSetup(f.d), 0)
  // Tried as typed, then with /v1.
  assert.deepEqual(f.config().custom, { homelab: { baseURL: 'http://box:8000/v1' } })
  assert.deepEqual(f.saved.at(-1)?.model, ['local', 'homelab:qwen3-27b'])
  assert.match(f.out(), /Fallback\s+qwen3-27b on homelab/)
})

test('a saved endpoint lists its models', async () => {
  const f = fake(['1', row('Custom'), row('homelab'), row('m2'), ''], {
    config: { custom: { homelab: { baseURL: 'http://box/v1', key: 's' } } },
    endpoints: { 'http://box/v1': ['m1', 'm2'] },
  })
  assert.equal(await runSetup(f.d), 0)
  assert.match(f.out(), /homelab  http:\/\/box\/v1/)
  assert.deepEqual(f.saved.at(-1)?.model, ['homelab:m2'])
})

test('an endpoint that does not answer is not saved', async () => {
  const f = fake(['1', row('Custom'), row('Add an endpoint'), 'homelab', 'http://nowhere/v1', '', '', '', ''])
  await runSetup(f.d)
  assert.equal(f.saved.length, 0)
  assert.match(f.out(), /Couldn't list models at http:\/\/nowhere\/v1\. Nothing was saved/)
})

test('a custom name may not be a provider id or local', async () => {
  const f = fake(['1', row('Custom'), row('Add an endpoint'), 'openai', 'local', '', '', '', ''])
  await runSetup(f.d)
  assert.match(f.out(), /openai is taken by OpenAI/)
  assert.match(f.out(), /local is taken by local models/)
  assert.equal(f.saved.length, 0)
})

// SET-23: the core alone, as a front end such as Raycast calls it.
test('the core answers with data and never prompts', async () => {
  const f = fake([], { config: KEYED, local: ['a'] })
  const status = await f.core.status()
  assert.equal(status.primary.label, 'any local model (fastest)')
  assert.equal(status.answering?.label, 'a')
  assert.equal(status.onlyRunning, false)
  assert.equal((await f.core.status({ launch: false })).onlyRunning, true)
  assert.deepEqual(
    (await f.core.slotMenu(1)).groups.map((g) => g.id),
    ['providers', 'local', 'custom'],
  )
  assert.equal((await f.core.slotMenu(0)).none, null)
  const models = await f.core.providerModels('anthropic', 0)
  assert.ok(models.ok)
  assert.deepEqual(
    models.recommended.map((c) => c.value),
    ['anthropic:claude-sonnet-5-5', 'anthropic:claude-haiku-5-5'],
  )
  assert.equal((await f.core.saveKey('anthropic', '  ')).ok, false)
  const set = await f.core.setSlot(1, 'anthropic:claude-sonnet-5-5')
  assert.ok(set.changed)
  assert.equal(set.status.fallback?.label, 'claude-sonnet-5-5 on Anthropic')
})

// SET-25
test('a resolved model is named model first', () => {
  assert.equal(modelLabel({ backend: 'lmstudio', modelId: 'qwen3-4b', local: true }), 'qwen3-4b')
  assert.equal(modelLabel({ backend: 'anthropic', modelId: 'claude-sonnet-5-5', local: false }), 'claude-sonnet-5-5 on Anthropic')
  assert.equal(modelLabel({ backend: 'homelab', modelId: 'm', local: false }), 'm on homelab')
  assert.equal(describe(null, undefined, { onlyRunning: true }), "navi can't find a running model to answer with.")
})

// SET-1, MOD-19
test('a replaced pin is named as gone in the status', () => {
  const answering = { index: 0, local: false, label: 'qwen3.6 on Darkbloom', replaced: 'qwen3.8' } as any
  assert.equal(
    describe(answering),
    'navi answers with qwen3.6 on Darkbloom, the primary (REMOTE: prompts leave this computer). The pinned qwen3.8 is gone; it serves only this model now.',
  )
})

test('a local model on two servers is one choice', async () => {
  const core = setupCore({
    load: async () => ({}),
    save: async () => {},
    env: {},
    resolve: async () => null,
    localModels: async () => [
      { backend: 'lmstudio', id: 'a' },
      { backend: 'ollama', id: 'a' },
    ],
    checkKey: async () => 'ok',
    fetchModels: async () => ({ ok: true, models: [] }),
    ask: async () => '',
  })
  assert.deepEqual(
    (await core.localModels(0)).map((c) => [c.value, c.label, c.detail]),
    [
      ['local:a', 'a', undefined],
      ['local', 'any local model (fastest)', undefined],
    ],
  )
})

// SET-26: every check can be cancelled; a cancelled one rejects and saves nothing.
test('cancelling a check rejects it and saves nothing', async () => {
  let open = () => {}
  const gate = { promise: new Promise<void>((r) => (open = r)), resolve: () => open() }
  const saved: Record<string, any>[] = []
  const seen: (AbortSignal | undefined)[] = []
  const core = setupCore({
    load: async () => ({ keys: { anthropic: 'k' }, custom: { box: { baseURL: 'http://box/v1' } } }),
    save: async (c) => {
      saved.push(c)
    },
    env: {},
    resolve: () => new Promise(() => {}),
    localModels: async (signal) => {
      seen.push(signal)
      return []
    },
    checkKey: async (_p, _k, signal) => {
      seen.push(signal)
      await gate.promise
      return 'ok'
    },
    fetchModels: async (_s, signal) => {
      seen.push(signal)
      return { ok: true, models: [{ id: 'm' }] }
    },
    ask: async (_o, signal) => {
      seen.push(signal)
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    },
  })
  const answering = { label: 'm' } as any
  const aborted = AbortSignal.abort()
  const isAbort = (e: any) => e?.name === 'AbortError'
  await assert.rejects(core.providerModels('anthropic', 0, { signal: aborted }), isAbort)
  await assert.rejects(core.customModels('box', 0, { signal: aborted }), isAbort)
  await assert.rejects(core.localModels(0, { signal: aborted }), isAbort)
  await assert.rejects(core.addCustom({ name: 'new', baseURL: 'http://new/v1' }, { signal: aborted }), isAbort)
  await assert.rejects(core.recheckLocal({ signal: aborted }), isAbort)

  // A resolution that never ends is let go when the signal aborts.
  const ctrl = new AbortController()
  const pending = core.status({ signal: ctrl.signal, launch: false })
  ctrl.abort()
  await assert.rejects(pending, isAbort)

  // A key check cancelled while it is out does not save the key, even when it is accepted.
  const k = new AbortController()
  const saving = core.saveKey('groq', 'gsk', { signal: k.signal })
  k.abort()
  gate.resolve()
  await assert.rejects(saving, isAbort)

  // The test question is cancelled, not reported as the model's failure.
  const t = new AbortController()
  const asking = core.test(answering, { signal: t.signal })
  t.abort()
  await assert.rejects(asking, isAbort)

  assert.equal(saved.length, 0)
  assert.ok(seen.length && seen.every((s) => s?.aborted))
})

test('a provider with no key has no models to list', async () => {
  const f = fake([])
  const list = await f.core.providerModels('mistral', 0)
  assert.ok(!list.ok && /no key/.test(list.message))
})

// SET-17
test('setting a slot keeps later links', () => {
  assert.deepEqual(setSlotIn(['a', 'b', 'c'], 0, 'x'), ['x', 'b', 'c'])
  assert.deepEqual(setSlotIn(['a', 'b', 'c'], 1, 'x'), ['a', 'x', 'c'])
  assert.deepEqual(setSlotIn(['a'], 1, 'x'), ['a', 'x'])
})

test('clearing the fallback, or a primary equal to it, drops it', () => {
  assert.deepEqual(setSlotIn(['a', 'b'], 1, null), ['a'])
  assert.deepEqual(setSlotIn(['a', 'b'], 0, 'b'), ['b'])
  assert.deepEqual(setSlotIn(['a', 'qwen3:4b'], 0, 'local:qwen3:4b'), ['local:qwen3:4b'])
  assert.deepEqual(setSlotIn(['local', 'x/y'], 0, 'openrouter:x/y'), ['openrouter:x/y'])
})

test('an unset chain is the default, spelled out', () => {
  assert.deepEqual(links(undefined), ['local'])
  assert.deepEqual(links('best, x/y'), ['best', 'x/y'])
})

test('each link reads as words', () => {
  assert.equal(labelFor('remote'), 'any free OpenRouter model')
  assert.equal(labelFor('x/y'), 'x/y on OpenRouter')
  assert.equal(labelFor('google:gemini-3.8-flash'), 'gemini-3.8-flash on Google Gemini')
  assert.equal(labelFor('box:m', ['box']), 'm on box')
  assert.equal(labelFor('local:qwen/qwen3-4b'), 'qwen/qwen3-4b on this computer')
  assert.equal(labelFor('best'), 'the largest local model')
})

// SET-12
test('EOF leaves without writing', async () => {
  const f = fake([null])
  assert.equal(await runSetup(f.d), 1)
  assert.equal(f.saved.length, 0)
})

test('EOF while typing a key leaves without writing', async () => {
  const f = fake(['1', row('Providers'), row('OpenAI'), null])
  assert.equal(await runSetup(f.d), 1)
  assert.equal(f.saved.length, 0)
})

// SET-9, SET-10
test('saving keeps other fields and writes mode 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify({ approve: 'judge', keys: { other: 'x' } }))
  const config = await loadConfig(dir)
  await saveConfig({ ...config, keys: { ...config.keys, openrouter: 'k' } }, dir)
  const back = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
  assert.deepEqual(back, { approve: 'judge', keys: { other: 'x', openrouter: 'k' } })
  assert.equal((await stat(join(dir, 'config.json'))).mode & 0o777, 0o600)
})

test('the core changes only the fields it sets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify({ approve: 'ask', web_search: false, model: ['best'] }))
  const core = setupCore({ ...realDeps(dir), checkKey: async () => 'ok' })
  assert.ok((await core.saveKey('groq', 'gsk-1')).ok)
  const back = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
  assert.deepEqual(back, { approve: 'ask', web_search: false, model: ['best'], keys: { groq: 'gsk-1' } })
})

test('a config that is not JSON stops setup without overwriting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  await writeFile(join(dir, 'config.json'), '{ not json')
  const out: string[] = []
  const d: SetupDeps = { ask: async () => null, askSecret: async () => null, print: (s) => out.push(s), core: setupCore(realDeps(dir)) }
  assert.equal(await runSetup(d), 1)
  assert.match(out.join('\n'), /not valid JSON/)
  assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), '{ not json')
})

test('a missing config loads as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  assert.deepEqual(await loadConfig(dir), {})
})

// SET-6: the key is read without echo.
test('a secret answer is read but not echoed', async () => {
  let shown = ''
  const output = new Writable({
    write: (c, _e, cb) => {
      shown += c
      cb()
    },
  })
  const line = makeLine({ input: Readable.from(['sk-or-secret\n']), output })
  assert.equal(await line.ask('key: ', { secret: true }), 'sk-or-secret')
  line.close()
  assert.ok(!shown.includes('sk-or-secret'))
})
