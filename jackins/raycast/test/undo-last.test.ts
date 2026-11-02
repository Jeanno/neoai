import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readUndone } from 'neonavi/ledger'
import { makeRecorder } from 'neonavi/undo'
import { redoLast, undoableFor, undoLast } from '../src/lib/undo-last'

async function setUp() {
  const home = await mkdtemp(join(tmpdir(), 'ray-undo-'))
  // readConfig looks in the real home; this one keeps it out of the user's.
  process.env.HOME = home
  const dir = join(home, '.navi-raycast')
  const file = join(home, 'notes.md')
  await writeFile(file, 'old\n')
  const r = makeRecorder(home, dir, 'tidy my notes')
  r.wrote(file, 'old\n', 'new\n')
  r.answeredBy('qwen')
  await writeFile(file, 'new\n')
  await r.saved()
  return { home, dir, file }
}

test('RAY-13: undo is offered on the question whose turn changed files, and only that one', async () => {
  const { home, dir } = await setUp()
  assert.ok(await undoableFor(home, dir, 'tidy my notes'))
  assert.equal(await undoableFor(home, dir, 'something else'), undefined)
  assert.equal(await undoableFor(home, join(home, 'elsewhere'), 'tidy my notes'), undefined)
})

test('RAY-13: undo puts the file back, says so, counts against the model and is offered no more', async () => {
  const { home, dir, file } = await setUp()
  const lines = await undoLast(home, dir)
  assert.equal(lines?.length, 1)
  assert.match(lines![0], /^put back .*notes\.md$/)
  assert.equal(await readFile(file, 'utf8'), 'old\n')
  assert.deepEqual(await readUndone(home), ['qwen'])
  assert.equal(await undoableFor(home, dir, 'tidy my notes'), undefined)
  assert.equal(await undoLast(home, dir), undefined)
})

test('RAY-14: redo brings the change back and makes it undoable again', async () => {
  const { home, dir, file } = await setUp()
  await undoLast(home, dir)
  const lines = await redoLast(home, dir)
  assert.equal(lines?.length, 1)
  assert.match(lines![0], /^redid /)
  assert.equal(await readFile(file, 'utf8'), 'new\n')
  assert.ok(await undoableFor(home, dir, 'tidy my notes'))
  assert.equal(await redoLast(home, dir), undefined)
})

test('RAY-13: with the ledger off, an undo is not counted', async () => {
  const { home, dir } = await setUp()
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify({ ledger: false }))
  await undoLast(home, dir)
  assert.deepEqual(await readUndone(home), [])
})
