import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kindOf, ledgerFile, readLedger, readsAsCorrection, readUndone, record, recordUndone, routeAway, stats, type LedgerEntry, type TurnKind } from '../src/ledger.ts'

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
