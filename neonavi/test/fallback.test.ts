import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulateReadableStream } from 'ai'
import { CallError } from 'neorouter'
import { createHarness, type HarnessEvent, type Model } from '../src/harness.ts'
import { chainModel, fellBackLine, type FellBack } from '../src/fallback.ts'
import { readLedger } from '../src/ledger.ts'
import type { Chosen, Entry } from '../src/spec.ts'

type Part = Awaited<ReturnType<Model['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never
type Call = Parameters<Model['doStream']>[0]

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const say = (words: string): Part[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: words },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: 'stop', usage },
]
const listing: Part[] = [
  { type: 'tool-call', toolCallId: 'c1', toolName: 'list_dir', input: '{"path":"."}' },
  { type: 'finish', finishReason: 'tool-calls', usage },
]

const busy = () => new CallError('neorouter: http://box/v1/chat/completions responded 429 …', 'busy', '429 capacity (queueFull)', 429)

/** A link's model: each call takes the next of `script` (a stream, or an error to throw); the last repeats. */
function link(name: string, script: (Part[] | Error)[]) {
  const calls: Call[] = []
  const model = {
    specificationVersion: 'v2',
    supportedUrls: {},
    provider: `neorouter:${name}`,
    modelId: name,
    streamsToolCalls: true,
    async doStream(o: Call) {
      calls.push(o)
      const next = script[Math.min(calls.length - 1, script.length - 1)]
      if (next instanceof Error) throw next
      return { stream: simulateReadableStream({ chunks: next }) }
    },
    async doGenerate(o: Call) {
      calls.push(o)
      const next = script[Math.min(calls.length - 1, script.length - 1)]
      if (next instanceof Error) throw next
      return { content: [{ type: 'text', text: 'UNSAFE' }], finishReason: 'stop', usage, warnings: [] }
    },
  } as unknown as Model
  return { model, calls }
}

const darkbloom: Entry = { where: 'remote', provider: 'Darkbloom', id: 'qwen3' }
const anthropic: Entry = { where: 'remote', provider: 'anthropic', id: 'claude-sonnet-5-5' }
const chosenFor = (entry: Entry, index: number, local: boolean): Chosen => ({
  entry,
  index,
  options: { think: false, model: entry.id, provider: entry.provider },
  contextWindow: 100_000,
  backend: entry.provider!,
  modelId: entry.id!,
  local,
})

/** A chain of the model (on this computer) and the backup (remote), with the links' scripts. */
function chainOf(model: (Part[] | Error)[], backup: (Part[] | Error)[] | { why: string }) {
  const first = link('Darkbloom', model)
  const second = 'why' in backup ? null : link('anthropic', backup)
  const chained = chainModel([darkbloom, anthropic], chosenFor(darkbloom, 0, true), {}, {
    make: (c) => (c.index === 0 ? first.model : second!.model) as never,
    resolve: async (entry, index) => ('why' in backup ? backup : chosenFor(entry, index, false)),
  })
  return { chained, first, second }
}

async function harnessOn(model: Model, front?: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'navi-fb-'))
  await writeFile(join(cwd, 'a.txt'), 'hello\n')
  return { cwd, h: await createHarness({ model, contextWindow: 100_000, cwd, home: cwd, config: { web_search: false }, ...(front && { front, name: { model: 'qwen3 on Darkbloom', local: true } }) }) }
}

async function collect(events: AsyncIterable<HarnessEvent>) {
  const out: HarnessEvent[] = []
  for await (const e of events) out.push(e)
  return out
}
const doneOf = (events: HarnessEvent[]) => events.at(-1) as Extract<HarnessEvent, { type: 'done' }>
const fellOf = (events: HarnessEvent[]) => events.filter((e) => e.type === 'fell-back') as (FellBack & { type: 'fell-back' })[]

// MOD-40, HAR-14, CLI-50
test('a busy model hands the turn to the backup, said in one line', async () => {
  const { chained, first, second } = chainOf([busy()], [say('from the backup')])
  const { h } = await harnessOn(chained)
  const events = await collect(h.session().turn('hi'))
  assert.equal(doneOf(events).text, 'from the backup')
  const fell = fellOf(events)
  assert.equal(fell.length, 1)
  assert.equal(fell[0].failed[0].trouble, 'busy')
  assert.equal(fell[0].again, false)
  assert.equal(
    fellBackLine(fell[0]),
    'the model is busy or at capacity (Darkbloom: 429 capacity (queueFull)); the backup, claude-sonnet-5-5 on Anthropic, answers (REMOTE: prompts leave this computer)',
  )
  assert.equal(first.calls.length, 1)
  assert.equal(second!.calls.length, 1)
  assert.equal(events.some((e) => e.type === 'error' || e.type === 'escalated'), false)
})

// MOD-40: the rest of the turn stays on the backup; the next turn tries the model once, without retries
test('the model is tried again next turn, once, and trusted again once it answers', async () => {
  const { chained, first, second } = chainOf([busy(), busy(), say('the model is back')], [listing, say('done'), say('backup again')])
  const { h } = await harnessOn(chained)
  const session = h.session()

  const one = await collect(session.turn('list it'))
  assert.equal(doneOf(one).text, 'done')
  // Two steps, both on the backup: the model was asked once.
  assert.equal(first.calls.length, 1)
  assert.equal(second!.calls.length, 2)
  assert.equal(fellOf(one).length, 1)
  assert.equal(first.calls[0].providerOptions?.neorouter?.retries, undefined)

  const two = await collect(session.turn('again'))
  assert.equal(doneOf(two).text, 'backup again')
  assert.equal(first.calls.length, 2)
  // Failed last turn: no waiting through its retries twice in a row.
  assert.equal(first.calls[1].providerOptions?.neorouter?.retries, 0)
  assert.equal(fellOf(two)[0].again, true)
  assert.match(fellBackLine(fellOf(two)[0]), /^the model is busy or at capacity again \(Darkbloom/)

  const three = await collect(session.turn('and now'))
  assert.equal(doneOf(three).text, 'the model is back')
  assert.equal(first.calls[2].providerOptions?.neorouter?.retries, 0)
  assert.equal(fellOf(three).length, 0)

  await collect(session.turn('once more'))
  // Answered last turn: its retries are back.
  assert.equal(first.calls[3].providerOptions?.neorouter?.retries, undefined)
})

// MOD-41: the request's own fault is not passed to the backup
test('a refused request does not fall back, and says so in words', async () => {
  const bad = new CallError('neorouter: … responded 400 …', 'request', '400 context length exceeded', 400)
  const { chained, second } = chainOf([bad], [say('never')])
  const { h } = await harnessOn(chained)
  const events = await collect(h.session().turn('hi'))
  const error = events.find((e) => e.type === 'error') as { error: Error } | undefined
  assert.equal(error?.error.message, 'the model, qwen3 on Darkbloom, refused the request (400 context length exceeded)')
  assert.equal(second!.calls.length, 0)
  assert.equal(fellOf(events).length, 0)
})

// MOD-43: with no link answering, each one tried and why
test('when no link answers, the error names each one and why', async () => {
  const refused = new CallError('neorouter: … responded 401 …', 'key', '401 invalid x-api-key', 401)
  const { chained } = chainOf([busy()], [refused])
  const { h } = await harnessOn(chained)
  const events = await collect(h.session().turn('hi'))
  const error = events.find((e) => e.type === 'error') as { error: Error } | undefined
  assert.equal(
    error?.error.message,
    'no model in the chain answered: the model, qwen3 on Darkbloom, is busy or at capacity (429 capacity (queueFull)); the backup, claude-sonnet-5-5 on Anthropic, had its key refused (401 invalid x-api-key)',
  )
})

// MOD-43: a backup that does not resolve says why, as MOD-21 words it
test('a backup that does not resolve is named with why', async () => {
  const { chained } = chainOf([busy()], { why: 'no key for Anthropic' })
  const { h } = await harnessOn(chained)
  const events = await collect(h.session().turn('hi'))
  const error = events.find((e) => e.type === 'error') as { error: Error } | undefined
  assert.match(error!.error.message, /the backup, claude-sonnet-5-5 on Anthropic, did not answer \(no key for Anthropic\)$/)
})

// MOD-40: a stopped call is the user's doing, not the link's
test('a stopped turn does not start the backup', async () => {
  const stop = new AbortController()
  const first = link('Darkbloom', [])
  let backupAsked = 0
  const chained = chainModel([darkbloom, anthropic], chosenFor(darkbloom, 0, true), {}, {
    make: (c) => {
      if (c.index === 1) backupAsked++
      return first.model as never
    },
    resolve: async (entry, index) => chosenFor(entry, index, false),
  })
  ;(first.model as { doStream: unknown }).doStream = async () => {
    stop.abort()
    throw new DOMException('aborted', 'AbortError')
  }
  await Promise.resolve(chained.doStream({ prompt: [], abortSignal: stop.signal } as unknown as Call)).catch(() => {})
  assert.equal(backupAsked, 0)
})

// HAR-14: the ledger counts the turn for the link that answered it
test('the ledger names the backup for a turn it answered', async () => {
  const { chained } = chainOf([busy()], [say('ok')])
  const { cwd, h } = await harnessOn(chained, 'cli')
  await collect(h.session().turn('hi'))
  const [entry] = await readLedger(cwd)
  assert.equal(entry.model, 'claude-sonnet-5-5 on Anthropic')
  assert.equal(entry.local, false)
})
