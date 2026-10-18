import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { labelFor, links, realDeps, runSetup, setSlot, type Found, type SetupDeps } from '../src/setup.ts'
import { makeLine } from '../src/approve.ts'
import type { Entry } from '../src/spec.ts'

/** A scripted answer: literal text, or computed from what has been printed so far. */
type Answer = string | null | ((out: string) => string)

/** The number of the most recently printed row with this label. */
const row = (label: string) => (out: string) => {
  const hits = [...out.matchAll(/^\s+(\d+)  (.*)$/gm)].filter((m) => m[2].startsWith(label))
  assert.ok(hits.length, `no row "${label}" in:\n${out}`)
  return hits.at(-1)![1]
}

const CATALOG = [
  { id: 'anthropic/claude-sonnet-5.5', input: 2, output: 10 },
  { id: 'deepseek/deepseek-v4.1-flash', input: 0.06, output: 0.12 },
]

/**
 * A scripted user and a fake world: which local models run (`local`, replaced
 * by the next of `localUp` each time setup probes for a local model), whether
 * there is an OpenRouter key, and what the OpenRouter catalogue prices.
 */
function fake(
  answers: Answer[],
  opts: { config?: Record<string, any>; local?: string[]; localUp?: string[][]; key?: 'ok' | 'rejected' | 'unreachable' } = {},
) {
  const out: string[] = []
  const saved: Record<string, any>[] = []
  let config = opts.config ?? {}
  let local = opts.local ?? []
  const localUp = [...(opts.localUp ?? [])]
  const next = async () => {
    const a = answers.length ? answers.shift()! : null
    return typeof a === 'function' ? a(out.join('\n')) : a
  }
  const resolveLink = (e: Entry): Omit<Found, 'index'> | null => {
    if (e.where === 'local') {
      const id = e.id ?? local[0]
      return id && local.includes(id) ? { label: `lmstudio · ${id}`, local: true } : null
    }
    if (e.where === 'remote') {
      if (!config.keys?.openrouter) return null
      if (e.id && !CATALOG.some((m) => m.id === e.id)) return null
      return { label: `openrouter · ${e.id ?? 'some/free-model'}`, local: false }
    }
    return { label: 'pollinations · openai', local: false }
  }
  const deps: SetupDeps = {
    ask: next,
    askSecret: next,
    print: (s) => out.push(s),
    probe: async (chain) => {
      if (chain.length === 1 && chain[0].where === 'local' && localUp.length) local = localUp.shift()!
      for (const [index, e] of chain.entries()) {
        const f = resolveLink(e)
        if (f) return { ...f, index }
      }
      return null
    },
    localModels: async () => local.map((id) => ({ backend: 'lmstudio', id })),
    pricedModels: async (ids) => CATALOG.filter((m) => ids.includes(m.id)),
    validateKey: async () => opts.key ?? 'ok',
    load: async () => config,
    save: async (c) => {
      config = c
      saved.push(structuredClone(c))
    },
    tryModel: async () => 'Hello there!',
  }
  return { deps, out: () => out.join('\n'), saved }
}

const KEYED = { keys: { openrouter: 'k' } }

// SET-1, SET-13
test('shows both slots and which one answers', async () => {
  const f = fake([''], { local: ['qwen3-4b'] })
  assert.equal(await runSetup(f.deps), 0)
  assert.match(f.out(), /Primary\s+any free OpenRouter model/)
  assert.match(f.out(), /Fallback\s+any local model \(fastest\)/)
  assert.match(f.out(), /lmstudio · qwen3-4b, the fallback \(on this computer\)/)
  assert.equal(f.saved.length, 0)
})

test('says when the answer is remote', async () => {
  const f = fake([''], { config: KEYED })
  await runSetup(f.deps)
  assert.match(f.out(), /the primary \(REMOTE/)
})

test('reports when nothing answers', async () => {
  const f = fake([''])
  assert.equal(await runSetup(f.deps), 1)
  assert.match(f.out(), /can't find a model/)
})

test('shows links after the fallback', async () => {
  const f = fake([''], { config: { model: ['local', 'remote', 'free'] } })
  await runSetup(f.deps)
  assert.match(f.out(), /Then\s+the free public model/)
})

// SET-2
test('--check exits 0 when a model answers and asks nothing', async () => {
  const f = fake(['1'], { local: ['qwen3-4b'] })
  assert.equal(await runSetup(f.deps, { check: true }), 0)
  assert.doesNotMatch(f.out(), /Primary/)
})

test('--check exits 1 with the next step when nothing answers', async () => {
  const f = fake(['1'])
  assert.equal(await runSetup(f.deps, { check: true }), 1)
  assert.match(f.out(), /navi setup/)
  assert.equal(f.saved.length, 0)
})

// SET-14, SET-17, SET-11
test('a specific local model becomes the primary, saved with local:', async () => {
  const f = fake(['1', row('lmstudio · qwen/qwen3-8b'), ''], { local: ['qwen3-4b', 'qwen/qwen3-8b'] })
  assert.equal(await runSetup(f.deps), 0)
  assert.deepEqual(f.saved.at(-1)?.model, ['local:qwen/qwen3-8b', 'local'])
  assert.match(f.out(), /lmstudio · qwen\/qwen3-8b, the primary/)
  assert.match(f.out(), /Hello there!/)
})

test('the fallback can be none, and never lists the primary', async () => {
  const f = fake(['2', row('none'), ''], { config: { model: ['local:a', 'local'] }, local: ['a', 'b'] })
  assert.equal(await runSetup(f.deps), 0)
  assert.deepEqual(f.saved.at(-1)?.model, ['local:a'])
  const listing = f.out().slice(f.out().indexOf('Choose a fallback'))
  assert.doesNotMatch(listing, /\d+  lmstudio · a\b/)
  assert.match(listing, /\d+  lmstudio · b/)
})

test('the current pick is marked', async () => {
  const f = fake(['1', '', ''], { config: { model: ['local:a'] }, local: ['a', 'b'] })
  await runSetup(f.deps)
  assert.match(f.out(), /lmstudio · a.*\(current\)/)
})

// SET-15
test('hand-picked OpenRouter models show with a key, cheapest first, priced', async () => {
  const f = fake(['1', row('deepseek/deepseek-v4.1-flash'), ''], { config: KEYED })
  assert.equal(await runSetup(f.deps), 0)
  const out = f.out()
  assert.ok(out.indexOf('deepseek/deepseek-v4.1-flash') < out.indexOf('anthropic/claude-sonnet-5.5'))
  assert.match(out, /deepseek\/deepseek-v4\.1-flash  \$0\.06 \/ \$0\.12/)
  assert.match(out, /bill your key/)
  assert.equal(f.saved.at(-1)?.model[0], 'deepseek/deepseek-v4.1-flash')
})

test('without a key no OpenRouter models are offered', async () => {
  const f = fake(['1', '', ''])
  await runSetup(f.deps)
  assert.doesNotMatch(f.out(), /deepseek|any free model/)
})

// SET-16, SET-5
test('adding a local model lists it in the same picker', async () => {
  const f = fake(['1', row('+ a local model'), '', '', row('lmstudio · qwen3-4b'), ''], {
    localUp: [[], ['qwen3-4b']],
  })
  assert.equal(await runSetup(f.deps), 0)
  assert.match(f.out(), /lmstudio\.ai/)
  assert.match(f.out(), /Nothing yet/)
  assert.deepEqual(f.saved.at(-1)?.model, ['local:qwen3-4b', 'local'])
})

test('going back from the local guide saves nothing', async () => {
  const f = fake(['1', row('+ a local model'), 'b', '', ''])
  assert.equal(await runSetup(f.deps), 1)
  assert.equal(f.saved.length, 0)
})

// SET-16, SET-6
test('a valid key is saved and its models appear in the picker', async () => {
  const f = fake(['1', row('+ an OpenRouter key'), 'sk-or-good', row('anthropic/claude-sonnet-5.5'), ''])
  assert.equal(await runSetup(f.deps), 0)
  assert.equal(f.saved[0].keys.openrouter, 'sk-or-good')
  assert.deepEqual(f.saved.at(-1)?.model, ['anthropic/claude-sonnet-5.5', 'local'])
})

test('a rejected key is not saved', async () => {
  const f = fake(['1', row('+ an OpenRouter key'), 'sk-or-bad', '', ''], { key: 'rejected' })
  assert.equal(await runSetup(f.deps), 1)
  assert.equal(f.saved.length, 0)
  assert.match(f.out(), /didn't accept/)
})

test('a key that cannot be checked is not saved', async () => {
  const f = fake(['1', row('+ an OpenRouter key'), 'sk-or-maybe', '', ''], { key: 'unreachable' })
  assert.equal(await runSetup(f.deps), 1)
  assert.equal(f.saved.length, 0)
  assert.match(f.out(), /Couldn't reach OpenRouter/)
})

// SET-16, SET-7
test('the free model needs an explicit yes after the warning', async () => {
  const f = fake(['2', row('+ the free public model'), '', '', ''])
  assert.equal(await runSetup(f.deps), 1)
  assert.equal(f.saved.length, 0)
  assert.match(f.out(), /Don't use it for anything private/)
})

test('yes to the free model picks it for the slot', async () => {
  const f = fake(['2', row('+ the free public model'), 'y', ''])
  assert.equal(await runSetup(f.deps), 0)
  assert.deepEqual(f.saved.at(-1)?.model, ['remote', 'free'])
})

test('the free model is listed once the chain uses it', async () => {
  const f = fake(['1', '', ''], { config: { model: ['local', 'free'] } })
  await runSetup(f.deps)
  assert.match(f.out(), /\d+  the free public model/)
})

// SET-17
test('setting a slot keeps later links', () => {
  assert.deepEqual(setSlot(['a', 'b', 'c'], 0, 'x'), ['x', 'b', 'c'])
  assert.deepEqual(setSlot(['a', 'b', 'c'], 1, 'x'), ['a', 'x', 'c'])
  assert.deepEqual(setSlot(['a'], 1, 'x'), ['a', 'x'])
})

test('clearing the fallback, or a primary equal to it, drops it', () => {
  assert.deepEqual(setSlot(['a', 'b'], 1, null), ['a'])
  assert.deepEqual(setSlot(['a', 'b'], 0, 'b'), ['b'])
  assert.deepEqual(setSlot(['a', 'qwen3:4b'], 0, 'local:qwen3:4b'), ['local:qwen3:4b'])
})

test('an unset chain is the default, spelled out', () => {
  assert.deepEqual(links(undefined), ['remote', 'local'])
  assert.deepEqual(links('best, x/y'), ['best', 'x/y'])
})

test('each link reads as words', () => {
  assert.equal(labelFor('remote'), 'any free OpenRouter model')
  assert.equal(labelFor('x/y'), 'x/y on OpenRouter')
  assert.equal(labelFor('local:qwen/qwen3-4b'), 'qwen/qwen3-4b on this computer')
  assert.equal(labelFor('best'), 'the largest local model')
})

// SET-12
test('EOF leaves without writing', async () => {
  const f = fake([null])
  assert.equal(await runSetup(f.deps), 1)
  assert.equal(f.saved.length, 0)
})

const quiet = { ask: async () => null, askSecret: async () => null, print: () => {} }

// SET-9, SET-10
test('saving keeps other fields and writes mode 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify({ approve: 'judge', keys: { other: 'x' } }))
  const d = realDeps(quiet, dir)
  const config = await d.load()
  await d.save({ ...config, keys: { ...config.keys, openrouter: 'k' } })
  const back = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
  assert.deepEqual(back, { approve: 'judge', keys: { other: 'x', openrouter: 'k' } })
  assert.equal((await stat(join(dir, 'config.json'))).mode & 0o777, 0o600)
})

test('a config that is not JSON stops setup without overwriting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  await writeFile(join(dir, 'config.json'), '{ not json')
  const out: string[] = []
  const d = { ...realDeps(quiet, dir), print: (s: string) => out.push(s) }
  assert.equal(await runSetup(d), 1)
  assert.match(out.join('\n'), /not valid JSON/)
  assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), '{ not json')
})

test('a missing config loads as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-setup-'))
  assert.deepEqual(await realDeps(quiet, dir).load(), {})
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
