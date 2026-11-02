import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KEPT_TURNS, listUndo, makeRecorder, MAX_KEPT, takeNote, undo, undoFile } from '../src/undo.ts'

const place = async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-undo-h-'))
  const cwd = await mkdtemp(join(tmpdir(), 'navi-undo-'))
  return { home, cwd, at: (f: string) => join(cwd, f) }
}

/** Writes as navi would, and records it. */
async function write(r: ReturnType<typeof makeRecorder>, path: string, after: string) {
  const before = await readFile(path, 'utf8').catch(() => null)
  await writeFile(path, after)
  r.wrote(path, before, after)
}

// UND-1, UND-4
test('undo puts edited files back and removes the ones the turn made', async () => {
  const { home, cwd, at } = await place()
  await writeFile(at('a.txt'), 'one\n')
  const r = makeRecorder(home, cwd, 'tidy up')
  await write(r, at('a.txt'), 'two\n')
  await write(r, at('a.txt'), 'three\n')
  await write(r, at('new.txt'), 'fresh\n')
  await write(r, at('new.txt'), 'fresher\n')
  await r.saved()
  assert.equal((await stat(undoFile(home, cwd))).mode & 0o777, 0o600)

  const got = await undo(home, cwd)
  assert.deepEqual({ restored: got?.restored, removed: got?.removed, left: got?.left }, { restored: ['a.txt'], removed: ['new.txt'], left: [] })
  assert.equal(await readFile(at('a.txt'), 'utf8'), 'one\n')
  await assert.rejects(stat(at('new.txt')))
  // UND-9
  assert.equal(await undo(home, cwd), undefined)
})

// UND-4: again goes further back.
test('undoing twice goes back two turns', async () => {
  const { home, cwd, at } = await place()
  await writeFile(at('a.txt'), 'v1')
  for (const v of ['v2', 'v3']) {
    const r = makeRecorder(home, cwd, `make it ${v}`)
    await write(r, at('a.txt'), v)
    await r.saved()
  }
  assert.equal((await undo(home, cwd))?.turn.prompt, 'make it v3')
  assert.equal(await readFile(at('a.txt'), 'utf8'), 'v2')
  await undo(home, cwd)
  assert.equal(await readFile(at('a.txt'), 'utf8'), 'v1')
})

// UND-5
test('a file changed since is left alone and named', async () => {
  const { home, cwd, at } = await place()
  await writeFile(at('a.txt'), 'mine')
  const r = makeRecorder(home, cwd, 'edit')
  await write(r, at('a.txt'), 'navi')
  await write(r, at('b.txt'), 'made')
  await r.saved()
  await writeFile(at('a.txt'), 'navi, then my own edit')
  const got = await undo(home, cwd)
  assert.deepEqual(got?.left, ['a.txt'])
  assert.deepEqual(got?.removed, ['b.txt'])
  assert.equal(await readFile(at('a.txt'), 'utf8'), 'navi, then my own edit')
})

// UND-2, UND-6, UND-8
test('turns keep their commands; only turns with changes are kept, the last few', async () => {
  const { home, cwd, at } = await place()
  const quiet = makeRecorder(home, cwd, 'just look')
  quiet.ran('ls')
  await quiet.saved()
  assert.deepEqual(await listUndo(home, cwd), [])

  for (let i = 0; i < KEPT_TURNS + 2; i++) {
    const r = makeRecorder(home, cwd, `turn ${i}`, () => new Date(Date.UTC(2026, 10, 1, 0, i)))
    r.ran(`echo ${i}`)
    await write(r, at('a.txt'), String(i))
    await r.saved()
  }
  const turns = await listUndo(home, cwd)
  assert.equal(turns.length, KEPT_TURNS)
  assert.equal(turns[0].prompt, `turn ${KEPT_TURNS + 1}`)
  assert.deepEqual(turns[0].commands, [`echo ${KEPT_TURNS + 1}`])
})

// UND-3
test('a file too big to keep is named, not undone', async () => {
  const { home, cwd, at } = await place()
  const r = makeRecorder(home, cwd, 'big')
  await write(r, at('big.txt'), 'x'.repeat(MAX_KEPT + 1))
  await r.saved()
  const got = await undo(home, cwd)
  assert.deepEqual(got?.big, ['big.txt'])
  assert.equal((await stat(at('big.txt'))).size, MAX_KEPT + 1)
})

// UND-7
test('the next turn is told once what was put back', async () => {
  const { home, cwd, at } = await place()
  const r = makeRecorder(home, cwd, 'rename things')
  await write(r, at('a.txt'), 'x')
  await r.saved()
  assert.equal(await takeNote(home, cwd), undefined)
  await undo(home, cwd)
  assert.match((await takeNote(home, cwd)) ?? '', /undid your file changes from the turn that began "rename things": a\.txt is back/)
  assert.equal(await takeNote(home, cwd), undefined)
})
