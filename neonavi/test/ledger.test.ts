import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ledgerFile, readLedger, readsAsCorrection, record, stats, type LedgerEntry } from '../src/ledger.ts'

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
