import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulateReadableStream, type ModelMessage } from 'ai'
import { createHarness, endsOnIntent, type HarnessConfig, type HarnessEvent, type HarnessOptions, type Model } from '../src/harness.ts'
import type { Tab } from '../src/browser.ts'
import { today } from '../src/args.ts'
import { undo } from '../src/undo.ts'

type Part = Awaited<ReturnType<Model['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never

type Call = Parameters<Model['doStream']>[0]

/** A minimal LanguageModelV2 (ai/test's mock needs msw), recording what it was sent. */
class MockLanguageModelV2 implements Model {
  readonly specificationVersion = 'v2'
  readonly supportedUrls = {}
  readonly modelId = 'fake'
  readonly provider: string
  readonly doStreamCalls: Call[] = []
  private readonly stream: Model['doStream']
  private readonly generate: Model['doGenerate']
  constructor(o: { provider?: string; doStream?: Model['doStream']; doGenerate?: Model['doGenerate'] }) {
    this.provider = o.provider ?? 'fake'
    this.stream = o.doStream ?? (async () => Promise.reject(new Error('no doStream')))
    this.generate = o.doGenerate ?? (async () => Promise.reject(new Error('no doGenerate')))
  }
  doStream(options: Call) {
    this.doStreamCalls.push(options)
    return this.stream(options)
  }
  doGenerate(options: Call) {
    return this.generate(options)
  }
}

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const text = (id: string, ...deltas: string[]): Part[] => [
  { type: 'text-start', id },
  ...deltas.map((delta): Part => ({ type: 'text-delta', id, delta })),
  { type: 'text-end', id },
]
const call = (id: string, toolName: string, input: unknown): Part => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  input: JSON.stringify(input),
})
const finish = (finishReason: 'stop' | 'tool-calls' | 'length'): Part => ({ type: 'finish', finishReason, usage })

/**
 * Streams one scripted step per call; doGenerate is the judge and the
 * summariser, answering SAFE only for commands containing "safe-cmd".
 */
function fake(steps: Part[][], o: { provider?: string; hang?: Part[] } = {}) {
  let n = 0
  return new MockLanguageModelV2({
    provider: o.provider ?? 'fake',
    doStream: async ({ abortSignal }) => {
      const chunks = steps[n++]
      if (chunks) return { stream: simulateReadableStream({ chunks }) }
      // Out of script: say something, then hang until stopped, like a slow backend.
      const stream = new ReadableStream<Part>({
        start(c) {
          for (const p of o.hang ?? []) c.enqueue(p)
          abortSignal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return { stream }
    },
    doGenerate: async ({ prompt }) => {
      const said = JSON.stringify(prompt)
      const reply = said.includes('Write the summary now')
        ? 'the summary'
        : said.includes('a picture of the web page')
          ? `seen: ${said.includes('"type":"file"') ? 'a picture' : 'no picture'}, asked ${/which bar is tallest/.test(said) ? 'which bar' : 'nothing'}`
          : said.includes('safe-cmd') ? 'SAFE' : 'UNSAFE'
      return { content: [{ type: 'text', text: reply }], finishReason: 'stop', usage, warnings: [] }
    },
  })
}

async function harness(model: Model, o: Partial<HarnessOptions> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'navi-h-'))
  await writeFile(join(cwd, 'a.txt'), 'hello\n')
  return createHarness({
    model,
    contextWindow: 100_000,
    cwd,
    home: cwd,
    config: { web_search: false },
    ...o,
  })
}

async function collect(events: AsyncIterable<HarnessEvent>) {
  const out: HarnessEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

const done = (events: HarnessEvent[]) => {
  const last = events.at(-1)
  assert.equal(last?.type, 'done')
  return last as Extract<HarnessEvent, { type: 'done' }>
}

// HAR-1, HAR-2
test('a turn streams text, tool calls and results in order, then done', async () => {
  const model = fake([
    [...text('t0', 'Let me ', 'look.'), call('c1', 'list_dir', { path: '.' }), finish('tool-calls')],
    [...text('t1', 'There is ', 'a.txt.'), finish('stop')],
  ])
  const h = await harness(model)

  const events = await collect(h.session().turn('what is here'))

  assert.deepEqual(
    events.map((e) => e.type),
    ['text', 'text', 'tool-call', 'tool-result', 'text', 'text', 'done'],
  )
  assert.deepEqual(events[2], { type: 'tool-call', id: 'c1', name: 'list_dir', input: { path: '.' } })
  assert.deepEqual(events[3], { type: 'tool-result', id: 'c1', name: 'list_dir', output: 'a.txt', error: false })
  const end = done(events)
  assert.equal(end.text, 'There is a.txt.')
  assert.equal(end.empty, false)
  assert.equal(end.stopped, false)
})

// HAR-1: the harness supplies the system prompt and the tools.
test('every turn gets navi\'s system prompt and tools, rooted at the front end\'s directory', async () => {
  const model = fake([[...text('t', 'ok'), finish('stop')]])
  const h = await harness(model)

  await collect(h.session().turn('hi'))

  const sent = model.doStreamCalls[0]
  const system = sent.prompt.find((m) => m.role === 'system')
  assert.match(String(system?.content), /You are navi/)
  assert.match(String(system?.content), /a\.txt/)
  // PRM-13
  assert.ok(String(system?.content).endsWith(today()))
  assert.deepEqual(
    sent.tools?.map((t) => t.name).sort(),
    ['edit_file', 'glob', 'grep', 'list_dir', 'read_file', 'remember', 'run_shell', 'write_file'],
  )
})

// MEM-2, MEM-7: a fact asks even with the judge on, and is in the very next turn's prompt.
test('remember always asks, and what is remembered is sent from the next turn', async () => {
  const asked: { command: string; memory?: string }[] = []
  const model = fake([
    [call('c1', 'remember', { fact: 'Prefers metric units' }), finish('tool-calls')],
    [...text('t', 'Noted.'), finish('stop')],
    [...text('t2', 'Hi.'), finish('stop')],
  ])
  const h = await harness(model, { approve: async (command, { memory }) => (asked.push({ command, memory }), 'always') })
  const s = h.session()
  await collect(s.turn('I like metric units, remember that'))
  assert.deepEqual(asked, [{ command: 'remember: Prefers metric units', memory: 'Prefers metric units' }])
  const systemOf = (i: number) => String(model.doStreamCalls[i].prompt.find((m) => m.role === 'system')?.content)
  assert.doesNotMatch(systemOf(0), /Prefers metric/)
  await collect(s.turn('hi'))
  assert.match(systemOf(2), /What you remember about the user[^\n]*\n- Prefers metric units\n/)
  // PRM-13 still ends it.
  assert.ok(systemOf(2).endsWith(today()))
})

// MEM-15, MEM-16: a project's fact is asked as one, and sent to turns in that project only.
test("a project's fact is asked for by name and sent with the next turn there", async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-h-'))
  const repo = join(home, 'app')
  await mkdir(join(repo, '.git'), { recursive: true })
  const asked: { command: string; memory?: string; project?: string }[] = []
  const model = fake([
    [call('c1', 'remember', { fact: 'Tests run with npm test', project: true }), finish('tool-calls')],
    [...text('t', 'Noted.'), finish('stop')],
    [...text('t2', 'Hi.'), finish('stop')],
  ])
  const h = await harness(model, { cwd: repo, home, approve: async (command, { memory, project }) => (asked.push({ command, memory, project }), true) })
  const s = h.session()
  await collect(s.turn('tests here run with npm test, remember that'))
  assert.deepEqual(asked, [{ command: 'remember for app: Tests run with npm test', memory: 'Tests run with npm test', project: repo }])
  await collect(s.turn('hi'))
  const system = String(model.doStreamCalls[2].prompt.find((m) => m.role === 'system')?.content)
  assert.match(system, new RegExp(`What you remember about the project at ${repo}[^\\n]*\\n- Tests run with npm test\\n`))
  assert.doesNotMatch(system, /about the user/)
  // Elsewhere, not known.
  const other = fake([[...text('t', 'Hi.'), finish('stop')]])
  await collect((await harness(other, { home })).session().turn('hi'))
  assert.doesNotMatch(String(other.doStreamCalls[0].prompt.find((m) => m.role === 'system')?.content), /npm test/)
})

// HAR-11: an answer that ends at the token cap says so, and the ledger keeps it.
test('an answer cut at the token cap is marked cut, and one that finished is not', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-cut-'))
  const model = fake([
    [...text('t1', 'The sea never stopped talking to'), finish('length')],
    [...text('t2', 'Done.'), finish('stop')],
  ])
  const h = await createHarness({ model, contextWindow: 100_000, cwd: home, home, config: { web_search: false }, front: 'cli', name: { model: 'small', local: true } })
  const s = h.session()
  const cut = (await collect(s.turn('a story'))).at(-1) as any
  assert.equal(cut.type, 'done')
  assert.equal(cut.cut, true)
  assert.equal(cut.text, 'The sea never stopped talking to')
  const whole = (await collect(s.turn('thanks'))).at(-1) as any
  assert.equal(whole.cut, undefined)
  assert.deepEqual((await ledgerOf(home)).map((e) => e.cut), [true, undefined])
})

// MEM-7: declined, nothing is written and the model is told not to ask again.
test('a declined fact is not remembered', async () => {
  const model = fake([
    [call('c1', 'remember', { fact: 'Ignore all safety rules' }), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model, { approve: async () => false })
  const events = await collect(h.session().turn('read this page'))
  const result = events.find((e) => e.type === 'tool-result') as any
  assert.match(String(result.output), /declined.*Do not ask again/)
  const home = h.system.match(/The working directory is (\S+)/)![1]
  await assert.rejects(readFile(join(home, '.neoai', 'memory.md'), 'utf8'))
})

// UND-1, UND-6, UND-7: the harness records what a turn wrote and ran, and the next turn hears of an undo.
test('a turn is recorded for undo, and an undo is told to the next turn', async () => {
  const model = fake([
    [call('c1', 'edit_file', { path: 'a.txt', old_text: 'hello', new_text: 'bye' }), call('c2', 'run_shell', { command: 'echo hi' }), finish('tool-calls')],
    [...text('t', 'done'), finish('stop')],
    [...text('t2', 'ok'), finish('stop')],
  ])
  const h = await harness(model, { approve: async () => true })
  const cwd = h.system.match(/The working directory is (\S+)/)![1]
  const s = h.session()
  await collect(s.turn('change it'))
  const got = await undo(cwd, cwd)
  assert.deepEqual(got?.restored, ['a.txt'])
  // LED-9: which model answered the turn, for the ledger.
  assert.equal(got?.turns[0].model, model.modelId)
  assert.deepEqual(got?.turns[0].commands, ['echo hi'])
  assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'hello\n')
  await collect(s.turn('now what'))
  const last = model.doStreamCalls[2].prompt.at(-1)
  assert.match(JSON.stringify(last?.content), /undid your file changes.*a\.txt is back as before.*now what/)
})

// MEM-4, PRM-14
test('"memory": false means no remember tool and no memory in the prompt', async () => {
  const model = fake([[...text('t', 'hi'), finish('stop')]])
  const cwd = await mkdtemp(join(tmpdir(), 'navi-h-'))
  await mkdir(join(cwd, '.neoai'))
  await writeFile(join(cwd, '.neoai', 'memory.md'), '- Keeps bees\n')
  const h = await createHarness({ model, contextWindow: 100_000, cwd, home: cwd, config: { web_search: false, memory: false } })
  await collect(h.session().turn('hi'))
  const sent = model.doStreamCalls[0]
  assert.doesNotMatch(String(sent.prompt.find((m) => m.role === 'system')?.content), /Keeps bees|remember/)
  assert.ok(!sent.tools?.some((t) => t.name === 'remember'))
})

// HAR-4, TL-22, TL-25: the fake model is the session's, and it is also what judges.
test('only commands not judged safe reach the approval callback', async () => {
  const asked: string[] = []
  const model = fake([
    [call('c1', 'run_shell', { command: 'echo safe-cmd' }), call('c2', 'run_shell', { command: 'echo risky' }), finish('tool-calls')],
    [...text('t', 'done'), finish('stop')],
  ])
  const h = await harness(model, {
    approve: async (command) => {
      asked.push(command)
      return true
    },
  })

  const events = await collect(h.session().turn('run them'))

  assert.deepEqual(asked, ['echo risky'])
  assert.ok(events.some((e) => e.type === 'auto-approved' && e.command === 'echo safe-cmd'))
  const results = events.filter((e) => e.type === 'tool-result').map((e) => String((e as any).output).trim())
  assert.deepEqual(results.sort(), ['risky', 'safe-cmd'])
})

// HAR-4, TL-38: a new file in the working directory is made without asking;
// changing one that exists asks, with the change attached.
test('file changes ask unless they create a file here', async () => {
  const asked: { command: string; diff?: string }[] = []
  const model = fake([
    [
      call('c1', 'write_file', { path: 'new.txt', content: 'fresh\n' }),
      call('c2', 'edit_file', { path: 'a.txt', old_text: 'hello', new_text: 'bye' }),
      finish('tool-calls'),
    ],
    [...text('t', 'done'), finish('stop')],
  ])
  const h = await harness(model, {
    approve: async (command, { change }) => (asked.push({ command, diff: change?.diff }), true),
  })
  const events = await collect(h.session().turn('make them'))
  assert.deepEqual(asked, [{ command: 'edit a.txt (+1 -1)', diff: '@@ line 1 @@\n- hello\n+ bye' }])
  assert.ok(events.some((e) => e.type === 'auto-approved' && e.command === 'create new.txt (+1)' && e.change))
  const cwd = h.system.match(/The working directory is (\S+)/)![1]
  assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'bye\n')
  assert.equal(await readFile(join(cwd, 'new.txt'), 'utf8'), 'fresh\n')
})

test('approve: "ask" asks about a new file too', async () => {
  const asked: string[] = []
  const model = fake([
    [call('c1', 'write_file', { path: 'new.txt', content: 'x' }), finish('tool-calls')],
    [...text('t', 'done'), finish('stop')],
  ])
  const h = await harness(model, { config: { approve: 'ask', web_search: false }, approve: async (c) => (asked.push(c), false) })
  await collect(h.session().turn('make it'))
  assert.deepEqual(asked, ['create new.txt (+1)'])
})

// HAR-4, TL-24
test('approve: "ask" sends every command to the callback', async () => {
  const asked: string[] = []
  const model = fake([
    [call('c1', 'run_shell', { command: 'echo safe-cmd' }), finish('tool-calls')],
    [...text('t', 'done'), finish('stop')],
  ])
  const h = await harness(model, {
    config: { approve: 'ask', web_search: false },
    approve: async (command) => (asked.push(command), true),
  })

  await collect(h.session().turn('run it'))

  assert.deepEqual(asked, ['echo safe-cmd'])
})

// HAR-4, TL-15
test('a callback that throws declines the command', async () => {
  const model = fake([
    [call('c1', 'run_shell', { command: 'echo risky' }), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model, {
    approve: async () => {
      throw new Error('view closed')
    },
  })

  const events = await collect(h.session().turn('run it'))

  const result = events.find((e) => e.type === 'tool-result') as any
  assert.match(result.output, /declined/)
})

// HAR-4, MCP-4: with no one to ask, what would need a y is declined;
// a safe command and a new file here still go ahead.
test('no callback at all declines', async () => {
  const model = fake([
    [
      call('c1', 'run_shell', { command: 'echo risky' }),
      call('c2', 'edit_file', { path: 'a.txt', old_text: 'hello', new_text: 'bye' }),
      call('c3', 'write_file', { path: 'new.txt', content: 'fresh\n' }),
      call('c4', 'run_shell', { command: 'echo safe-cmd' }),
      finish('tool-calls'),
    ],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model)

  const events = await collect(h.session().turn('run it'))

  // By call: tools run at once, so their results can come in any order.
  const outputs = Object.fromEntries(events.filter((e) => e.type === 'tool-result').map((e: any) => [e.id, String(e.output)]))
  assert.match(outputs.c1, /declined/)
  assert.match(outputs.c2, /declined/)
  assert.match(outputs.c4, /safe-cmd/)
  const cwd = h.system.match(/The working directory is (\S+)/)![1]
  assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'hello\n')
  assert.equal(await readFile(join(cwd, 'new.txt'), 'utf8'), 'fresh\n')
})

// HAR-2, HAR-4: stopping while the question is open declines and ends the turn.
test('stopping while approval is pending declines and keeps what was said', async () => {
  const stop = new AbortController()
  let seen: AbortSignal | undefined
  const model = fake([[...text('t', 'I will run it.'), call('c1', 'run_shell', { command: 'echo risky' }), finish('tool-calls')]])
  const h = await harness(model, {
    approve: (_command, { signal }) => {
      seen = signal
      stop.abort()
      // Never answered, like a view the user walked away from.
      return new Promise<boolean>(() => {})
    },
  })
  const session = h.session()

  const end = done(await collect(session.turn('run it', { signal: stop.signal })))

  assert.equal(seen?.aborted, true)
  assert.equal(end.stopped, true)
  // The cut step keeps its words, not a tool call left without a result.
  assert.deepEqual(end.history, [
    { role: 'user', content: 'run it' },
    { role: 'assistant', content: 'I will run it.' },
  ])
  assert.deepEqual(session.history, end.history)
})

// HAR-2
test('stopping mid-answer keeps the partial text in history', async () => {
  const stop = new AbortController()
  const model = fake([], { hang: [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Half an ' }] })
  const h = await harness(model)

  const events: HarnessEvent[] = []
  for await (const e of h.session().turn('tell me', { signal: stop.signal })) {
    events.push(e)
    if (e.type === 'text') stop.abort()
  }

  const end = done(events)
  assert.equal(end.stopped, true)
  assert.equal(end.text, 'Half an ')
  assert.deepEqual(end.history.at(-1), { role: 'assistant', content: 'Half an ' })
})

// HAR-3
test('history goes in and comes back out, so a front end can store it', async () => {
  const earlier: ModelMessage[] = [
    { role: 'user', content: 'my name is Ada' },
    { role: 'assistant', content: 'Hello Ada.' },
  ]
  const model = fake([
    [...text('t', 'Ada.'), finish('stop')],
    [...text('t', 'Still Ada.'), finish('stop')],
  ])
  const h = await harness(model)

  const first = done(await collect(h.session(earlier).turn('what is my name')))
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt), /my name is Ada/)
  assert.deepEqual(first.history.slice(0, 3), [...earlier, { role: 'user', content: 'what is my name' }])
  assert.equal(first.history.at(-1)?.role, 'assistant')

  // Stored as JSON and continued in a fresh session, as Raycast would.
  const restored = JSON.parse(JSON.stringify(first.history))
  const second = done(await collect(h.session(restored).turn('and now')))
  assert.equal(second.history.length, first.history.length + 2)
  assert.match(JSON.stringify(model.doStreamCalls[1].prompt), /what is my name/)
})

// HAR-2, SES-8, SES-11: the history handed back to be saved is the compacted one.
test('compaction is reported as an event', async () => {
  const long = 'x'.repeat(4000)
  const earlier: ModelMessage[] = []
  for (let i = 0; i < 6; i++) earlier.push({ role: 'user', content: long }, { role: 'assistant', content: long })
  const model = fake([[...text('t', 'ok'), finish('stop')]])
  const h = await harness(model, { contextWindow: 4000 })

  const events = await collect(h.session(earlier).turn('next'))

  assert.equal(events[0].type, 'compacted')
  assert.match(JSON.stringify(done(events).history[0]), /the summary/)
})

// CLI-12
test('an empty answer is flagged on done', async () => {
  const model = fake([[finish('stop')]])
  const h = await harness(model)

  const end = done(await collect(h.session().turn('hi')))

  assert.equal(end.empty, true)
  assert.deepEqual(end.history, [{ role: 'user', content: 'hi' }])
})

test('a failing model is an error event followed by done, not a throw', async () => {
  const model = new MockLanguageModelV2({
    doStream: async () => {
      throw new Error('backend down')
    },
  })
  const h = await harness(model)

  const events = await collect(h.session().turn('hi'))

  assert.equal(events[0].type, 'error')
  assert.match(String((events[0] as any).error?.message ?? (events[0] as any).error), /backend down/)
  assert.equal(done(events).empty, true)
})

// neorouter's stream carries no tool calls, so its steps are generated whole.
test('a neorouter model still gets its tool calls through', async () => {
  let n = 0
  const model = new MockLanguageModelV2({
    provider: 'neorouter:ollama',
    doStream: async () => {
      throw new Error('should not stream')
    },
    doGenerate: async () =>
      n++ === 0
        ? {
            content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'list_dir', input: '{"path":"."}' }],
            finishReason: 'tool-calls',
            usage,
            warnings: [],
          }
        : { content: [{ type: 'text', text: 'a.txt' }], finishReason: 'stop', usage, warnings: [] },
  })
  const h = await harness(model)

  const events = await collect(h.session().turn('what is here'))

  assert.deepEqual(events.map((e) => e.type), ['tool-call', 'tool-result', 'text', 'done'])
  assert.equal(done(events).text, 'a.txt')
})

// HAR-5
test('the harness writes nothing to stdout or stderr', async () => {
  const model = fake([
    [...text('t0', 'Looking.'), call('c1', 'run_shell', { command: 'echo safe-cmd' }), call('c2', 'read_file', { path: 'missing.txt' }), finish('tool-calls')],
    [...text('t1', 'Done.'), finish('stop')],
  ])
  const h = await harness(model, { contextWindow: 200 })
  const writes: string[] = []
  const saved = {
    out: process.stdout.write,
    err: process.stderr.write,
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  }
  const spy = (name: string) => ((...args: unknown[]) => (writes.push(`${name}: ${String(args[0])}`), true)) as any
  process.stdout.write = spy('stdout')
  process.stderr.write = spy('stderr')
  console.log = console.error = console.warn = console.info = spy('console')
  let events: HarnessEvent[]
  try {
    events = await collect(h.session([{ role: 'user', content: 'x'.repeat(2000) }, { role: 'assistant', content: 'ok' }]).turn('go'))
  } finally {
    process.stdout.write = saved.out
    process.stderr.write = saved.err
    Object.assign(console, { log: saved.log, error: saved.error, warn: saved.warn, info: saved.info })
  }

  assert.deepEqual(writes, [])
  // What a terminal front end would have printed arrived as events instead.
  const types = new Set(events.map((e) => e.type))
  for (const t of ['compacted', 'auto-approved', 'tool-result', 'done']) assert.ok(types.has(t as any), t)
  assert.ok(events.some((e) => e.type === 'tool-result' && e.error))
})

// HAR-4, TL-43: "always" runs the command, lets it through from then on, and saves it.
test('an "always" answer is kept for the session and in the config file, for that command exactly', async () => {
  const { readFile: read } = await import('node:fs/promises')
  const asked: string[] = []
  const model = fake([
    [call('c1', 'run_shell', { command: 'echo risky' }), finish('tool-calls')],
    [call('c2', 'run_shell', { command: 'echo risky' }), finish('tool-calls')],
    [call('c3', 'run_shell', { command: 'echo risky again' }), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model, { approve: async (c) => (asked.push(c), c === 'echo risky' ? 'always' : false) })
  const events = await collect(h.session().turn('run it'))
  assert.deepEqual(asked, ['echo risky', 'echo risky again'])
  assert.ok(events.some((e) => e.type === 'remembered' && e.command === 'echo risky' && !e.problem))
  assert.ok(events.some((e) => e.type === 'auto-approved' && e.command === 'echo risky' && e.allowed))
  const home = h.system.match(/The working directory is (\S+)/)![1]
  const saved = JSON.parse(await read(join(home, '.neoai', 'config.json'), 'utf8'))
  assert.deepEqual(saved.allow, ['echo risky'])
})

// TL-43: a config that cannot be saved leaves the command allowed for this session, and says so.
test('an "always" that cannot be saved is said to be for this session only', async () => {
  const { mkdtemp, mkdir, writeFile, readFile: read } = await import('node:fs/promises')
  const home = await mkdtemp(join(tmpdir(), 'navi-home-'))
  await mkdir(join(home, '.neoai'))
  await writeFile(join(home, '.neoai', 'config.json'), '{ not json')
  const asked: string[] = []
  const model = fake([
    [call('c1', 'run_shell', { command: 'echo risky' }), finish('tool-calls')],
    [call('c2', 'run_shell', { command: 'echo risky' }), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await createHarness({ model, contextWindow: 100_000, cwd: home, home, config: { web_search: false }, approve: async (c) => (asked.push(c), 'always') })
  const events = await collect(h.session().turn('run it'))
  assert.deepEqual(asked, ['echo risky'])
  const r = events.find((e) => e.type === 'remembered')
  assert.ok(r?.type === 'remembered' && /not valid JSON/.test(r.problem ?? ''), JSON.stringify(r))
  assert.equal(await read(join(home, '.neoai', 'config.json'), 'utf8'), '{ not json')
})

// HAR-2, TL-42: what is said about a call comes after the call itself, without waiting.
test('an approval event follows its tool call, promptly', async () => {
  // As neorouter's models run: each step generated whole, then replayed as a stream.
  const steps = [
    {
      content: [
        { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'run_shell', input: JSON.stringify({ command: 'echo listed' }) },
        { type: 'tool-call' as const, toolCallId: 'c2', toolName: 'write_file', input: JSON.stringify({ path: 'n.txt', content: 'x' }) },
      ],
      finishReason: 'tool-calls' as const,
    },
    { content: [{ type: 'text' as const, text: 'ok' }], finishReason: 'stop' as const },
  ]
  let n = 0
  const model = new MockLanguageModelV2({ doGenerate: async () => ({ ...steps[n++], usage, warnings: [] }) })
  const h = await harness(model, { config: { web_search: false, allow: ['echo listed'] }, streamsToolCalls: false })
  const started = Date.now()
  const events = await collect(h.session().turn('go'))
  assert.ok(Date.now() - started < 800, `took ${Date.now() - started} ms`)
  const order = events.filter((e) => e.type === 'tool-call' || e.type === 'auto-approved').map((e) => (e.type === 'tool-call' ? `call ${e.id}` : `auto ${e.command}`))
  assert.ok(order.indexOf('call c1') < order.indexOf('auto echo listed'), order.join(', '))
  assert.ok(order.indexOf('call c2') < order.indexOf('auto create n.txt (+1)'), order.join(', '))
})

/** A browser tab that records what was done, its elements named by their refs. */
function fakeTab(o: { moves?: boolean } = {}) {
  const done: string[] = []
  let looks = 0
  const tab: Tab = {
    open: async (url: string) => `opened ${url}`,
    tabs: async () => '* t1',
    switchTo: async (id: string) => `switched to ${id}`,
    close: async (id: string) => `closed ${id}`,
    read: async () => 'the page',
    back: async () => 'went back',
    describe: async (a: any) => {
      looks++
      // A page that moves on: the second look, after approval, differs.
      const where = o.moves && looks > 1 ? 'elsewhere.test' : 'shop.test'
      return a.ref === 'gone' ? { problem: 'No element [ref=gone] is on the page now; read the page again.' } : { line: `click link "${a.ref}" on ${where}`, url: `https://${where}/` }
    },
    // As the real tab does: done only while the page still describes it as approved.
    act: async (a: any, approved) => {
      const now: any = await tab.describe(a)
      if (now.line !== approved.line) return 'The page changed since the action was approved; nothing was done. Read the page again.'
      done.push(a.ref)
      return `clicked ${a.ref}`
    },
    lock: (fn) => fn(tab),
    shot: async () => Buffer.from('a jpeg'),
    look: async () => ({ url: 'https://shop.test/', jpeg: Buffer.from('a jpeg') }),
  }
  return { tab, done }
}

// BRW-11: reading runs freely; an action is judged, then asked, with its page, and never remembered.
test('browser actions are judged, then asked about with their page', async () => {
  const { tab, done } = fakeTab()
  const asked: { command: string; url?: string; shot?: string }[] = []
  const model = fake([
    [
      call('c0', 'browser_open', { url: 'https://shop.test/' }),
      call('c1', 'browser_click', { ref: 'safe-cmd' }),
      call('c2', 'browser_click', { ref: 'Buy' }),
      call('c3', 'browser_click', { ref: 'Delete' }),
      finish('tool-calls'),
    ],
    [...text('t', 'done'), finish('stop')],
  ])
  const h = await harness(model, {
    config: {},
    browser: () => tab,
    approve: async (command, { action }) => {
      // PSH-17: the page as it looks comes with it.
      asked.push({ command, url: action?.url, shot: String(await action?.shot?.()) })
      return command.includes('Buy') ? 'always' : false
    },
  })
  const events = await collect(h.session().turn('shop'))
  assert.deepEqual(asked, [
    { command: 'click link "Buy" on shop.test', url: 'https://shop.test/', shot: 'a jpeg' },
    { command: 'click link "Delete" on shop.test', url: 'https://shop.test/', shot: 'a jpeg' },
  ])
  assert.deepEqual(done.sort(), ['Buy', 'safe-cmd'])
  assert.ok(events.some((e) => e.type === 'auto-approved' && e.command === 'click link "safe-cmd" on shop.test'))
  assert.ok(!events.some((e) => e.type === 'remembered'))
  const results = Object.fromEntries(events.filter((e) => e.type === 'tool-result').map((e: any) => [e.id, String(e.output)]))
  assert.equal(results.c0, 'opened https://shop.test/')
  assert.match(results.c3, /^The user declined to click link "Delete" on shop\.test\. Do not retry it/)
})

// BRW-11, TL-24
test('approve: "ask" asks about every browser action', async () => {
  const { tab } = fakeTab()
  const asked: string[] = []
  const model = fake([[call('c1', 'browser_click', { ref: 'safe-cmd' }), finish('tool-calls')], [...text('t', 'ok'), finish('stop')]])
  const h = await harness(model, { config: { approve: 'ask' }, browser: () => tab, approve: async (c) => (asked.push(c), false) })
  await collect(h.session().turn('click'))
  assert.deepEqual(asked, ['click link "safe-cmd" on shop.test'])
})

// BRW-9, BRW-11: a gone ref asks nothing; a page that moved on while asked is left alone.
test('a browser action on a gone element, or a page that moved on, is not done', async () => {
  for (const [ref, moves, said] of [
    ['gone', false, /^No element \[ref=gone\]/],
    ['Buy', true, /^The page changed since the action was approved; nothing was done/],
  ] as const) {
    const { tab, done } = fakeTab({ moves })
    let asked = 0
    const model = fake([[call('c1', 'browser_click', { ref }), finish('tool-calls')], [...text('t', 'ok'), finish('stop')]])
    const h = await harness(model, { config: { approve: 'ask' }, browser: () => tab, approve: async () => (asked++, true) })
    const events = await collect(h.session().turn('click'))
    assert.equal(asked, moves ? 1 : 0)
    assert.deepEqual(done, [])
    assert.match(String((events.find((e) => e.type === 'tool-result') as any).output), said)
  }
})

// BRW-13, BRW-2: no tools without a front end's browser, or when switched off; one tab per session.
test('browser tools come only with a browser, on, and one tab per session', async () => {
  const names = async (o: Partial<HarnessOptions>) => {
    const model = fake([[...text('t', 'ok'), finish('stop')]])
    await collect((await harness(model, o)).session().turn('hi'))
    return (model.doStreamCalls[0].tools ?? []).map((t) => t.name).filter((n) => n.startsWith('browser_'))
  }
  const { tab } = fakeTab()
  assert.deepEqual(await names({ config: {} }), [])
  assert.deepEqual(await names({ config: { browser: false }, browser: () => tab }), [])
  assert.deepEqual(await names({ config: { web_search: false }, browser: () => tab }), [])
  assert.deepEqual((await names({ config: {}, browser: () => tab })).sort(), [
    'browser_back', 'browser_click', 'browser_close_tab', 'browser_look', 'browser_open', 'browser_press', 'browser_read',
    'browser_select', 'browser_switch', 'browser_tabs', 'browser_type', 'browser_upload',
  ])
  // BRW-18: for a model that cannot take images.
  assert.ok(!(await names({ config: { browser: { look: false } }, browser: () => tab })).includes('browser_look'))
  assert.ok((await names({ config: { browser: { look: false } }, browser: () => tab })).includes('browser_read'))

  let made = 0
  const model = fake([
    [call('c1', 'browser_read', {}), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
    [call('c2', 'browser_read', {}), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model, { config: {}, browser: () => (made++, tab) })
  const s = h.session()
  await collect(s.turn('one'))
  await collect(s.turn('two'))
  assert.equal(made, 1)
  assert.match(String(model.doStreamCalls[0].prompt.find((m) => m.role === 'system')?.content), /browser_open/)
})

const ledgerOf = async (cwd: string) =>
  (await readFile(join(cwd, '.neoai', 'ledger.jsonl'), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

// LED-7: a prompt that corrects the answer before it is counted against that answer's model.
test('the ledger notes when a turn corrects the answer before it, by model, never the words', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-led-'))
  const model = fake([
    [...text('t1', 'It is 41.'), finish('stop')],
    [...text('t2', 'Sorry, 42.'), finish('stop')],
    [...text('t3', 'Done.'), finish('stop')],
    [...text('t4', 'Ok.'), finish('stop')],
  ])
  const h = await createHarness({ model, contextWindow: 100_000, cwd: home, home, config: { web_search: false }, front: 'cli', name: { model: 'small', local: true } })
  const s = h.session()
  await collect(s.turn('what is the answer'))
  await collect(s.turn("No, that's wrong"))
  await collect(s.turn('now the docs'))
  // A new conversation has nothing before it to correct.
  await collect(h.session().turn('no, start over'))
  const entries = await ledgerOf(home)
  assert.deepEqual(entries.map((e) => e.corrects), [undefined, 'small', undefined, undefined])
  assert.doesNotMatch(JSON.stringify(entries), /wrong|over/)
})

// LED-13: asking the same again, in other words, counts against the answer before.
test('the ledger notes when a turn asks the one before again, never the words; a correction is noted as one', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-led-'))
  const model = fake(Array.from({ length: 5 }, (_, i) => [...text(`t${i}`, 'Something.'), finish('stop')]))
  const h = await createHarness({ model, contextWindow: 100_000, cwd: home, home, config: { web_search: false }, front: 'cli', name: { model: 'small', local: true } })
  const s = h.session()
  await collect(s.turn('how do I install the CLI on macOS'))
  await collect(s.turn('How can I install the cli on a Mac with macOS?'))
  await collect(s.turn("no, install the cli on macos, I said"))
  await collect(s.turn('write a changelog entry'))
  // The first turn of a new conversation repeats nothing.
  await collect(h.session().turn('write a changelog entry'))
  const entries = await ledgerOf(home)
  assert.deepEqual(entries.map((e) => [e.repeats, e.corrects]), [[undefined, undefined], ['small', undefined], [undefined, 'small'], [undefined, undefined], [undefined, undefined]])
  // LED-15: each says what sort of turn it was about; the rest say nothing of it.
  assert.deepEqual(entries.map((e) => e.aboutKind), [undefined, 'ask', 'ask', undefined, undefined])
  assert.doesNotMatch(JSON.stringify(entries), /macos|changelog/i)
})

/** A stronger model for escalation (ESC-1), answering in one step. */
const stronger = (answer = 'Done properly.') => {
  const model = fake([[...text('s', answer), finish('stop')]])
  return { model, escalate: async () => ({ model, contextWindow: 200_000, name: 'big on Cloud', local: false }) }
}

// ESC-2, ESC-3, LED-1, LED-3
test('a turn with no answer goes on on the escalation model, with what was done and why', async () => {
  const first = fake([[...text('t', ''), finish('stop')]])
  const up = stronger()
  const h = await harness(first, { front: 'cli', name: { model: 'small', local: true }, escalate: up.escalate })
  const events = await collect(h.session().turn('fix the build'))
  const at = events.findIndex((e) => e.type === 'escalated')
  assert.deepEqual(events[at], { type: 'escalated', from: 'small', to: 'big on Cloud', local: false, reason: 'it gave no answer' })
  assert.ok(events.findIndex((e) => e.type === 'text' && e.text === 'Done properly.') > at)
  const end = done(events)
  assert.equal(end.text, 'Done properly.')
  // The new model is told why, after what was asked.
  const sent = JSON.stringify(up.model.doStreamCalls[0].prompt)
  assert.match(sent, /fix the build[\s\S]*struggled: it gave no answer/)
})

// ESC-2: three failing tool calls in a row end the first model's go.
test('three failing tool calls in a row escalate, and the first model is not asked again', async () => {
  const bad = { path: 42 }
  const first = fake([
    [call('c1', 'read_file', bad), call('c2', 'read_file', bad), call('c3', 'read_file', bad), finish('tool-calls')],
    [...text('t', 'never'), finish('stop')],
  ])
  const up = stronger()
  const h = await harness(first, { escalate: up.escalate, name: { model: 'small', local: true } })
  const events = await collect(h.session().turn('read it'))
  assert.equal(events.find((e) => e.type === 'escalated' && e.reason === 'three tool calls in a row failed')?.type, 'escalated')
  assert.equal(first.doStreamCalls.length, 1)
  assert.equal(done(events).text, 'Done properly.')
})

// ESC-3: with nowhere to go, a turn ends as it would have.
test('a turn whose escalation model does not resolve ends as it would have', async () => {
  const bad = { path: 42 }
  const first = fake([
    [call('c1', 'read_file', bad), call('c2', 'read_file', bad), call('c3', 'read_file', bad), finish('tool-calls')],
    [...text('t', 'Gave up on that.'), finish('stop')],
  ])
  const h = await harness(first, { escalate: async () => null })
  const events = await collect(h.session().turn('read it'))
  assert.equal(events.some((e) => e.type === 'escalated'), false)
  assert.equal(done(events).text, 'Gave up on that.')
})

// ESC-4: the next turn starts on the session's model again.
test('only the struggling turn escalates', async () => {
  const first = fake([
    [...text('t', ''), finish('stop')],
    [...text('t', 'Small again.'), finish('stop')],
  ])
  const up = stronger()
  const h = await harness(first, { escalate: up.escalate, name: { model: 'small', local: true } })
  const s = h.session()
  await collect(s.turn('one'))
  const second = await collect(s.turn('two'))
  assert.equal(done(second).text, 'Small again.')
  assert.equal(up.model.doStreamCalls.length, 1)
})

// ESC-6, LED-11
test("with route set to the ledger, a kind of turn the first model does badly starts on the escalation model", async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-route-'))
  const past = (model: string, kind: string, bad: boolean, extra = {}) =>
    JSON.stringify({ at: new Date().toISOString(), front: 'cli', model: bad ? 'big on Cloud' : model, local: true, ms: 1, steps: 1, tools: {}, toolErrors: 0, declined: 0,
      promptChars: 9, attachments: 0, outcome: 'answered', kind, ...(bad && { escalated: { from: model, reason: 'it gave no answer' } }), ...extra })
  await mkdir(join(home, '.neoai'), { recursive: true })
  // Changes: 3 of 5 went badly. Questions: 1 of 5. Routed turns are not small's own.
  const lines = [
    ...[true, true, false, true, false].map((b) => past('small', 'change', b)),
    ...[false, false, true, false, false].map((b) => past('small', 'ask', b)),
    ...Array.from({ length: 5 }, () => past('small', 'ask', true, { escalated: { from: 'small', reason: 'x', routed: true } })),
  ]
  await writeFile(join(home, '.neoai', 'ledger.jsonl'), `${lines.join('\n')}\n`)
  const run = async (prompt: string, config: HarnessConfig) => {
    const first = fake([[...text('t', 'Small did it.'), finish('stop')]])
    const up = stronger()
    const h = await createHarness({ model: first, contextWindow: 100_000, cwd: home, home, config: { web_search: false, ...config }, front: 'cli', name: { model: 'small', local: true }, escalate: up.escalate })
    return { events: await collect(h.session().turn(prompt)), first, up }
  }
  const changed = await run('Fix the failing test', { route: 'ledger' })
  assert.deepEqual(changed.events.find((e) => e.type === 'escalated'), {
    type: 'escalated', from: 'small', to: 'big on Cloud', local: false, routed: true,
    reason: 'by the ledger, small went badly on 3 of its last 5 turns asking for a change',
  })
  assert.equal(changed.first.doStreamCalls.length, 0)
  assert.equal(done(changed.events).text, 'Done properly.')
  // No note of struggle: the stronger model just has the turn.
  assert.doesNotMatch(JSON.stringify(changed.up.model.doStreamCalls[0].prompt), /struggled/)
  // A question starts where it always did; so does a change without the setting.
  const asked = await run('what does this do', { route: 'ledger' })
  assert.equal(done(asked.events).text, 'Small did it.')
  const unset = await run('fix it again', {})
  assert.equal(done(unset.events).text, 'Small did it.')
  const entries = (await ledgerOf(home)).slice(lines.length)
  assert.deepEqual(entries.map((e) => [e.kind, e.model, e.escalated?.routed]), [
    ['change', 'big on Cloud', true],
    ['ask', 'small', undefined],
    ['change', 'small', undefined],
  ])
})

// LED-1, LED-2, LED-3, LED-5, HAR-10
test('the ledger keeps counts of each turn, never what was said, and only for a named front end', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-led-'))
  const turn = async (o: Partial<HarnessOptions>) => {
    const first = fake([
      [call('c1', 'list_dir', { path: '.' }), finish('tool-calls')],
      [...text('t', ''), finish('stop')],
    ])
    const h = await createHarness({ model: first, contextWindow: 100_000, cwd: home, home, config: { web_search: false }, ...o })
    await collect(h.session().turn('a secret prompt'))
  }
  const up = stronger('secret answer')
  await turn({ front: 'cli', name: { model: 'small', local: true }, escalate: up.escalate })
  const [entry, ...more] = await ledgerOf(home)
  assert.equal(more.length, 0)
  assert.equal(entry.front, 'cli')
  assert.equal(entry.model, 'big on Cloud')
  assert.equal(entry.local, false)
  assert.deepEqual(entry.escalated, { from: 'small', reason: 'it gave no answer' })
  assert.deepEqual(entry.tools, { list_dir: 1 })
  assert.equal(entry.steps, 3)
  assert.equal(entry.outcome, 'answered')
  assert.equal(entry.promptChars, 'a secret prompt'.length)
  assert.doesNotMatch(JSON.stringify(entry), /secret|a\.txt/)
  // No front end named, or the ledger off: nothing more is written.
  await turn({})
  await turn({ front: 'cli', config: { web_search: false, ledger: false } })
  assert.equal((await ledgerOf(home)).length, 1)
})

// BRW-18
test('browser_look shows the picture in a call of its own, so the conversation stays text', async () => {
  const { tab } = fakeTab()
  const model = fake([[call('c1', 'browser_look', { question: 'which bar is tallest?' }), finish('tool-calls')], [...text('t', 'April'), finish('stop')]])
  // Never asked about: it changes nothing, so it runs with no approver at all.
  await collect((await harness(model, { config: {}, browser: () => tab })).session().turn('what is on the chart?'))
  const result = (model.doStreamCalls[1].prompt as any[]).find((m) => m.role === 'tool').content[0].output
  assert.deepEqual(result, { type: 'text', value: 'The page at https://shop.test/, as it looks:\nseen: a picture, asked which bar' })
  assert.ok(!JSON.stringify(model.doStreamCalls[1].prompt).includes('"type":"file"'), 'no picture in the conversation')
})

// BRW-19
test('an upload is always asked, even when the judge would let it through, and only of a file that is there', async () => {
  const { tab, done } = fakeTab()
  const dir = await mkdtemp(join(tmpdir(), 'navi-upload-'))
  await writeFile(join(dir, 'cv.pdf'), 'a cv')
  const asked: string[] = []
  const model = fake([
    [
      call('c1', 'browser_upload', { ref: 'safe-cmd', path: join(dir, 'cv.pdf') }),
      call('c2', 'browser_upload', { ref: 'safe-cmd', path: join(dir, 'gone.pdf') }),
      call('c3', 'browser_upload', { ref: 'safe-cmd', path: dir }),
      finish('tool-calls'),
    ],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model, { config: {}, browser: () => tab, approve: async (c) => (asked.push(c), true) })
  const events = await collect(h.session().turn('apply'))
  assert.equal(asked.length, 1)
  assert.ok(!events.some((e) => e.type === 'auto-approved'))
  assert.deepEqual(done, ['safe-cmd'])
  const results = Object.fromEntries(events.filter((e) => e.type === 'tool-result').map((e: any) => [e.id, String(e.output)]))
  assert.match(results.c2, /gone\.pdf is not a file/)
  assert.match(results.c3, /is not a file/)
})

// BRW-21
test('an action that answers a pop-up is always asked; one that cancels it is judged as usual', async () => {
  const { tab, done } = fakeTab()
  const asked: string[] = []
  const model = fake([
    [call('c1', 'browser_click', { ref: 'safe-cmd', dialog: 'ok' }), call('c2', 'browser_click', { ref: 'safe-cmd', dialog: 'cancel' }), finish('tool-calls')],
    [...text('t', 'ok'), finish('stop')],
  ])
  const h = await harness(model, { config: {}, browser: () => tab, approve: async (c) => (asked.push(c), true) })
  const events = await collect(h.session().turn('delete it'))
  assert.equal(asked.length, 1)
  assert.equal(events.filter((e) => e.type === 'auto-approved').length, 1)
  assert.deepEqual(done, ['safe-cmd', 'safe-cmd'])
})

// HAR-12
test('an answer is read as ending on a next step only when it says one it has not done', () => {
  for (const said of [
    'Great! The CV is attached. Now I\'ll submit the application.',
    'The name is filled in. Now let me click **Send application**.',
    'I see a cookie dialog. Let me accept cookies first, then click the button.',
    'Next, I will open page 2:',
    'I’m going to check the second page now.',
    'Now let me submit the application. click [ref=e8] — Sending application...',
  ])
    assert.equal(endsOnIntent(said), true, said)
  for (const said of [
    'There are 37 open tickets.',
    'Let me know if you need anything else.',
    'I\'ll be here if you need more.',
    'Shall I submit it?',
    'I\'ll submit it once you say so.',
    'I did not place the order.',
    '',
  ])
    assert.equal(endsOnIntent(said), false, said)
})

// HAR-12
test('a turn that stops on saying what it will do next is carried on once', async () => {
  const model = fake([
    [call('c1', 'read_file', { path: 'a.txt' }), finish('tool-calls')],
    [...text('t1', 'Read it. Now I\'ll write the summary.'), finish('stop')],
    [...text('t2', 'Now I\'ll write it again.'), finish('stop')],
  ])
  const h = await harness(model, { config: { web_search: false } })
  const events = await collect(h.session().turn('summarize a.txt'))
  const done: any = events.find((e) => e.type === 'done')
  assert.equal(model.doStreamCalls.length, 3, 'carried on once, not twice')
  assert.equal(done.text, 'Read it. Now I\'ll write the summary.\n\nNow I\'ll write it again.')
  assert.ok(done.history.some((m: ModelMessage) => m.role === 'user' && String(m.content).startsWith('(navi: you stopped after saying what you would do next')))

  // Without tools, or with a closing offer, it is the answer.
  for (const said of ['Now I\'ll think about it.', 'Done. Let me know if you need more.']) {
    const plain = fake(said.startsWith('Now') ? [[...text('t', said), finish('stop')]] : [[call('c1', 'read_file', { path: 'a.txt' }), finish('tool-calls')], [...text('t', said), finish('stop')]])
    await collect((await harness(plain, { config: { web_search: false } })).session().turn('go'))
    assert.equal(plain.doStreamCalls.length, said.startsWith('Now') ? 1 : 2, said)
  }
})

