import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulateReadableStream, type ModelMessage } from 'ai'
import { createHarness, type HarnessEvent, type HarnessOptions, type Model } from '../src/harness.ts'

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
const finish = (finishReason: 'stop' | 'tool-calls'): Part => ({ type: 'finish', finishReason, usage })

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
      const reply = said.includes('Write the summary now') ? 'the summary' : said.includes('safe-cmd') ? 'SAFE' : 'UNSAFE'
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
  assert.deepEqual(
    sent.tools?.map((t) => t.name).sort(),
    ['edit_file', 'glob', 'grep', 'list_dir', 'read_file', 'run_shell', 'write_file'],
  )
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

  const outputs = events.filter((e) => e.type === 'tool-result').map((e) => String((e as any).output))
  assert.match(outputs[0], /declined/)
  assert.match(outputs[1], /declined/)
  assert.match(outputs[3], /safe-cmd/)
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
