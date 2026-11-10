import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addTokens, kindOf, ledgerFile, readLedger, readsAsCorrection, readsAsRepeat, readUndone, readUndoneEntries, record, recordUndone, routeAway, stats, type LedgerEntry, type TurnKind } from '../src/ledger.ts'

const entry = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: new Date().toISOString(),
  front: 'cli',
  model: 'qwen on Darkbloom',
  local: true,
  ms: 2000,
  steps: 2,
  tools: {},
  toolErrors: 0,
  declined: 0,
  promptChars: 10,
  attachments: 0,
  outcome: 'answered',
  ...o,
})

// LED-4
test('the ledger is private, skips lines it cannot read, and drops its older half past 5 MB', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-ledger-'))
  await record(home, entry())
  assert.equal((await stat(ledgerFile(home))).mode & 0o777, 0o600)
  assert.equal((await stat(join(home, '.neoai'))).mode & 0o777, 0o700)
  await appendFile(ledgerFile(home), '{"cut off\n')
  await record(home, entry({ model: 'other' }))
  assert.deepEqual((await readLedger(home)).map((e) => e.model), ['qwen on Darkbloom', 'other'])
  // Old turns are left out of a window.
  assert.equal((await readLedger(home, Date.now() + 1000)).length, 0)
  const line = `${JSON.stringify(entry({ model: 'filler' }))}\n`
  await writeFile(ledgerFile(home), line.repeat(Math.ceil((5.2 * 1024 * 1024) / line.length)))
  await record(home, entry({ model: 'newest' }))
  assert.ok((await stat(ledgerFile(home))).size < 3 * 1024 * 1024)
  assert.equal((await readLedger(home)).at(-1)?.model, 'newest')
  // A home it cannot write to is not an error.
  await record('/nonexistent/home', entry())
})

// LED-6
test('stats are one line per model, most turns first, with escalations counted against where they started', () => {
  assert.equal(stats([], 30), 'No turns recorded in the last 30 days.')
  const out = stats(
    [
      entry({ ms: 1000 }),
      entry({ ms: 3000, outcome: 'empty', toolErrors: 2 }),
      entry({ ms: 2000, steps: 4 }),
      entry({ model: 'claude on Anthropic', local: false, ms: 20_000, escalated: { from: 'qwen on Darkbloom', reason: 'it gave no answer' } }),
    ],
    7,
  )
  assert.equal(
    out,
    [
      'Last 7 days, 4 turns:',
      '  qwen on Darkbloom: 3 turns · 67% answered · 33% empty · 2.7 steps · 0.7 tool errors · median 2.0s · 1 escalated away',
      '  claude on Anthropic (REMOTE): 1 turn · 100% answered · 2.0 steps · 0.0 tool errors · median 20s',
    ].join('\n'),
  )
})

// LED-7: by the first words only.
test('a prompt reads as a correction by how it starts', () => {
  for (const p of [
    'No, the other file',
    'nope',
    "That's wrong, it is 42",
    'that’s not what I asked',
    'It still doesn’t work',
    'still failing with the same error',
    'Try again, but shorter',
    'you forgot the tests',
    'not quite: use tabs',
    'Wrong file.',
    '...no',
    'it broke the build',
    'this didnt help',
  ])
    assert.ok(readsAsCorrection(p), p)
  for (const p of [
    'No worries, now do the docs',
    'no need to run the tests',
    'Thanks! Now the README',
    'Why is the build wrong?',
    'what does "not quite" mean in this log',
    'Is it still working?',
    'note this down',
    'nothing else, thanks',
    '',
  ])
    assert.ok(!readsAsCorrection(p), p)
})

// LED-8
test('stats show the share of a model’s answers the user then corrected', () => {
  const out = stats(
    [entry(), entry(), entry(), entry({ corrects: 'qwen on Darkbloom' }), entry({ model: 'claude on Anthropic', local: false })],
    7,
  )
  assert.match(out, /qwen on Darkbloom: 4 turns · 100% answered · 25% of answers corrected · /)
  assert.doesNotMatch(out.split('\n')[2], /corrected/)
})

// LED-9, LED-10
test('an undo is a line of its own naming whose turn it was, and stats show the share of edits undone', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-led-'))
  await record(home, entry())
  await recordUndone(home, [{ model: 'qwen on Darkbloom' }, {}], true, new Date('2026-11-02T10:00:00Z'))
  await recordUndone(home, [{ model: 'qwen on Darkbloom' }], false)
  assert.equal((await readLedger(home)).length, 1)
  assert.deepEqual(await readUndone(home), ['qwen on Darkbloom'])
  assert.deepEqual(await readUndone(home, Date.parse('2026-11-02T11:00:00Z')), [])
  const turns = [entry({ tools: { edit_file: 2 } }), entry({ tools: { write_file: 1 } }), entry(), entry({ model: 'claude on Anthropic', local: false })]
  const out = stats(turns, 7, ['qwen on Darkbloom'])
  assert.match(out, /qwen on Darkbloom: 3 turns · 100% answered · 50% of edits undone · /)
  assert.doesNotMatch(out.split('\n')[2], /undone/)
  // Undone with no edit on record (older lines): a count.
  assert.match(stats([entry()], 7, ['qwen on Darkbloom']), /· 1 undone ·/)
})

// LED-11
test('a turn is sorted by its first words and files, never kept as words', () => {
  assert.equal(kindOf('Fix the failing test', 0), 'change')
  assert.equal(kindOf('please add a README', 0), 'change')
  assert.equal(kindOf('can you rename foo to bar', 0), 'change')
  assert.equal(kindOf('  "update" the docs', 0), 'change')
  assert.equal(kindOf('what does fix do', 0), 'ask')
  assert.equal(kindOf('why is the build red', 0), 'ask')
  assert.equal(kindOf('fix this', 2), 'attached')
})

// ESC-6
test('routing away needs enough turns of the kind, more than half gone badly, and counts only turns started there', () => {
  const e = (model: string, kind: TurnKind, how: 'ok' | 'escalated' | 'error' | 'stopped' | 'routed'): LedgerEntry => ({
    at: '2026-11-01T00:00:00Z', front: 'cli', model: how === 'ok' || how === 'error' || how === 'stopped' ? model : 'big', local: true, ms: 1, steps: 1, tools: {},
    toolErrors: 0, declined: 0, promptChars: 1, attachments: 0, kind,
    outcome: how === 'error' ? 'error' : how === 'stopped' ? 'stopped' : 'answered',
    ...(how === 'escalated' && { escalated: { from: model, reason: 'r' } }),
    ...(how === 'routed' && { escalated: { from: model, reason: 'r', routed: true as const } }),
  })
  const four = [e('s', 'change', 'escalated'), e('s', 'change', 'error'), e('s', 'change', 'escalated'), e('s', 'change', 'ok')]
  // Four is too few, and stopped or routed turns do not add to it.
  assert.equal(routeAway([...four, e('s', 'change', 'stopped'), e('s', 'change', 'routed')], 's', 'change'), undefined)
  assert.equal(routeAway([...four, e('s', 'change', 'ok')], 's', 'change'), 'by the ledger, s went badly on 3 of its last 5 turns asking for a change')
  // Half is not more than half; another model's or another kind's turns do not count.
  assert.equal(routeAway([...four, e('s', 'change', 'ok'), e('s', 'change', 'ok')], 's', 'change'), undefined)
  assert.equal(routeAway([...four, e('s', 'change', 'ok')], 'other', 'change'), undefined)
  assert.equal(routeAway([...four, e('s', 'change', 'ok')], 's', 'ask'), undefined)
  // LED-12
  assert.match(stats([...four, e('s', 'change', 'routed')], 30), /s: 2 turns .* 2 escalated away · 1 routed past it/)
  // Only the latest ten: good turns since put it back.
  const recovered = [...four, ...Array.from({ length: 10 }, () => e('s', 'change', 'ok'))]
  assert.equal(routeAway(recovered, 's', 'change'), undefined)
})

// LED-13
test('a prompt that asks the one before again, in other words, reads as a repeat; a new request does not', () => {
  assert.equal(readsAsRepeat('how do I install the CLI on macOS', 'How can I install the cli on a Mac with macOS?'), true)
  assert.equal(readsAsRepeat('Summarise the release notes for 2.3', 'summarise the 2.3 release notes'), true)
  assert.equal(readsAsRepeat('fix the login bug', 'fix the signup bug'), false)
  assert.equal(readsAsRepeat('now add tests for the parser', 'write the parser for dates'), false)
  // Too few words to tell.
  assert.equal(readsAsRepeat('do it', 'do it'), false)
})

// LED-14
test('navi stats shows the share of answers asked for again', () => {
  const e = (extra: Partial<LedgerEntry>): LedgerEntry => ({ at: '2026-11-01T00:00:00Z', front: 'cli', model: 'q', local: true, ms: 1000, steps: 1, tools: {}, toolErrors: 0, declined: 0, promptChars: 1, attachments: 0, outcome: 'answered', ...extra })
  assert.match(stats([e({}), e({}), e({}), e({ repeats: 'q' })], 30), /q: 4 turns · 100% answered · 25% asked again ·/)
})

// ESC-7, LED-15
test('corrections, repeats and undos of a kind count against the model when routing, from its first sampled turn on', async () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString()
  const turn = (m: number, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({ at: at(m), front: 'cli', model: 's', local: true, ms: 1, steps: 1, tools: {},
    toolErrors: 0, declined: 0, promptChars: 1, attachments: 0, outcome: 'answered', kind: 'change', ...extra })
  const five = [1, 2, 3, 4, 5].map((m) => turn(m))
  assert.equal(routeAway(five, 's', 'change'), undefined)
  // Two corrections and a repeat of its change answers: 3 of 5.
  const told = [turn(6, { kind: 'ask', corrects: 's', aboutKind: 'change' }), turn(7, { kind: 'ask', repeats: 's', aboutKind: 'change' }), turn(8, { kind: 'ask', corrects: 's', aboutKind: 'change' })]
  // The three told-turns are questions of s's own, so they are its ask sample; its change sample stays at five.
  assert.equal(routeAway([...five, ...told], 's', 'change'), 'by the ledger, s went badly on 3 of its last 5 turns asking for a change')
  // About another kind, or another model, they do not count.
  assert.equal(routeAway([...five, ...told.map((t) => ({ ...t, aboutKind: 'ask' as const }))], 's', 'change'), undefined)
  assert.equal(routeAway([...five, ...told.map((t) => ({ ...t, corrects: t.corrects && 'x', repeats: t.repeats && 'x' }))], 's', 'change'), undefined)
  // Undos count the same way; one from before the sample does not.
  const undone = [{ at: at(0), undid: 's', kind: 'change' as const }, { at: at(6), undid: 's', kind: 'change' as const }, { at: at(7), undid: 's', kind: 'change' as const }]
  assert.equal(routeAway(five, 's', 'change', undone), undefined)
  assert.match(routeAway(five, 's', 'change', [...undone, { at: at(9), undid: 's', kind: 'change' }]) ?? '', /3 of its last 5/)
  // Never more bad turns than turns.
  const failing = five.map((t) => ({ ...t, outcome: 'error' as const }))
  assert.match(routeAway(failing, 's', 'change', undone) ?? '', /5 of its last 5/)
})

// LED-15
test('an undo line keeps the kind of the turn it undid, by its prompt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-led-'))
  await recordUndone(home, [{ model: 'm', prompt: 'fix the footer' }, { model: 'm', prompt: 'what is in here' }, { model: 'm' }], true)
  assert.deepEqual((await readUndoneEntries(home)).map((e) => e.kind), ['change', 'ask', undefined])
  assert.deepEqual(await readUndone(home), ['m', 'm', 'm'])
})

// LED-16
test("stats shows a model's turns by kind, and the kinds routing would start elsewhere now", () => {
  const e = (kind: TurnKind, o: Partial<LedgerEntry> = {}) => entry({ model: 'q', kind, ...o })
  const turns = [
    e('change', { tools: { edit_file: 1 } }),
    e('change', { tools: { edit_file: 1 } }),
    e('change', { outcome: 'error' }),
    e('change'),
    e('ask'),
    e('ask', { corrects: 'q', aboutKind: 'change' }),
    e('ask', { repeats: 'q', aboutKind: 'ask' }),
  ]
  const undone = [{ at: new Date().toISOString(), undid: 'q', kind: 'change' as const }]
  const out = stats(turns, 30, undone)
  assert.match(out, /\n {6}changes: 4 turns · 75% answered · 33% corrected · 50% of edits undone\n/)
  assert.match(out, /\n {6}questions: 3 turns · 100% answered · 33% asked again$/)
  assert.doesNotMatch(out, /with files|routing/)
  // One kind alone says nothing more than the model's line.
  assert.equal(stats([e('ask'), e('ask')], 30).split('\n').length, 2)
  // Routing on: a kind gone badly is marked, even when it is the only kind shown.
  const bad = Array.from({ length: 5 }, () => e('change', { outcome: 'error' }))
  const routed = stats([e('ask')], 30, [], { entries: bad, undone: [] })
  assert.match(routed, /\n {6}changes: 0 turns · routing starts these elsewhere now\n {6}questions: 1 turn · 100% answered$/)
  assert.doesNotMatch(stats([e('ask'), e('change')], 30, [], { entries: bad.slice(0, 4), undone: [] }), /routing/)
})

// LED-18: a step with no counts adds nothing; cached tokens are part of `in`.
test('tokens add up over steps, and a step with no counts adds nothing', () => {
  assert.equal(addTokens(undefined, { inputTokens: undefined, outputTokens: undefined }), undefined)
  const one = addTokens(undefined, { inputTokens: 100, outputTokens: 10 })
  assert.deepEqual(one, { in: 100, out: 10 })
  assert.deepEqual(addTokens(one, { inputTokens: 200, outputTokens: 5, cachedInputTokens: 90 }), { in: 300, out: 15, cached: 90 })
})

// LED-19, LED-20
test('stats show each model\'s tokens and what they cost, and a total', () => {
  const sonnet = { model: 'claude-sonnet-5-5 on Anthropic', local: false }
  const out = stats(
    [
      entry({ tokens: { in: 50_000, out: 2_000 } }),
      entry({ ...sonnet, tokens: { in: 1_000_000, out: 100_000, cached: 500_000 } }),
      entry({ model: 'anthropic/claude-haiku-5.5 on OpenRouter', local: false, tokens: { in: 1_000_000, out: 0 } }),
      entry({ model: 'mystery on Cloud', local: false, tokens: { in: 1_000, out: 1_000 } }),
      entry({ ...sonnet }),
    ],
    7,
  )
  const lines = out.split('\n')
  assert.match(lines.find((l) => l.startsWith('  qwen'))!, / · 50k in, 2k out · free$/)
  // Sonnet 5.5: 500k at $2, 500k cached at $0.20, 100k out at $10.
  assert.match(lines.find((l) => l.startsWith('  claude-sonnet'))!, / · 1M in, 100k out · ~\$2\.10$/)
  assert.match(lines.find((l) => l.startsWith('  anthropic/claude-haiku'))!, / · ~\$0\.10$/)
  assert.match(lines.find((l) => l.startsWith('  mystery'))!, / · price unknown$/)
  assert.equal(lines.at(-1), 'Estimated cost: ~$2.20, from list prices, leaving out 1 model with no price; 1 turn has no token counts.')
  // The config's price wins over the list's.
  const own = stats([entry({ ...sonnet, tokens: { in: 1_000_000, out: 0 } })], 7, [], undefined, { 'claude-sonnet-5-5': { in: 1, out: 1 } })
  assert.match(own, /out · ~\$1\.00\n/)
  // Turns from before token counting: no cost line at all.
  assert.doesNotMatch(stats([entry()], 7), /Estimated/)
})
