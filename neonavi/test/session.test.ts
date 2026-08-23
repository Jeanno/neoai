import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionFile, loadSession, saveSession, trim } from '../src/session.ts'

const msg = (role: 'user' | 'assistant', text: string) => ({ role, content: text }) as any

test('each directory gets its own session file', () => {
  const a = sessionFile('/Users/x/projects/one', '/home')
  const b = sessionFile('/Users/x/projects/two', '/home')

  assert.notEqual(a, b)
})

test('the same directory always maps to the same file', () => {
  assert.equal(sessionFile('/Users/x/one', '/home'), sessionFile('/Users/x/one', '/home'))
})

test('a directory with no history starts empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))

  assert.deepEqual(await loadSession(join(dir, 'missing.json')), [])
})

test('what was saved comes back on the next run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))
  const file = join(dir, 's.json')

  await saveSession(file, [msg('user', 'what is this'), msg('assistant', 'a monorepo')])

  assert.deepEqual(await loadSession(file), [
    msg('user', 'what is this'),
    msg('assistant', 'a monorepo'),
  ])
})

// A half-written or hand-edited file must not take the CLI down.
test('a corrupt session file reads as empty rather than throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))
  const file = join(dir, 'bad.json')
  await writeFile(file, '{not json')

  assert.deepEqual(await loadSession(file), [])
})

test('saving creates the directory when it does not exist yet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))
  const file = join(dir, 'nested', 'deeper', 's.json')

  await saveSession(file, [msg('user', 'hi')])

  assert.match(await readFile(file, 'utf8'), /hi/)
})

test('trim keeps the most recent turns and drops the oldest', () => {
  const many = Array.from({ length: 50 }, (_, i) => msg('user', `message ${i}`))

  const kept = trim(many, 10)

  assert.equal(kept.length, 10)
  assert.deepEqual(kept.at(-1), msg('user', 'message 49'))
  assert.deepEqual(kept[0], msg('user', 'message 40'))
})

test('trim leaves a short history alone', () => {
  const few = [msg('user', 'a'), msg('assistant', 'b')]

  assert.deepEqual(trim(few, 10), few)
})
