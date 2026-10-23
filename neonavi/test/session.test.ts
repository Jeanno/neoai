import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { sessionFile, loadSession, saveSession } from '../src/session.ts'

const msg = (role: 'user' | 'assistant', text: string) => ({ role, content: text }) as any

// SES-2
test('each directory gets its own session file', () => {
  const a = sessionFile('/Users/x/projects/one', '/home')
  const b = sessionFile('/Users/x/projects/two', '/home')

  assert.notEqual(a, b)
})

// SES-1
test('history lives beside the config, in one app directory', () => {
  assert.match(sessionFile('/Users/x/one', '/home'), /^\/home\/\.neoai\/sessions\//)
})

// SES-6: these files hold whatever navi has read: file contents, shell output. They
// were world-readable at 0755.
test('the session directory is not readable by other users', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-p-'))
  const file = join(dir, 'sessions', 's.json')

  await saveSession(file, [msg('user', 'secret')])

  const mode = (await stat(join(dir, 'sessions'))).mode & 0o777
  assert.equal(mode.toString(8), '700')
})

// SES-2
test('the same directory always maps to the same file', () => {
  assert.equal(sessionFile('/Users/x/one', '/home'), sessionFile('/Users/x/one', '/home'))
})

// SES-5
test('a directory with no history starts empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))

  assert.deepEqual(await loadSession(join(dir, 'missing.json')), [])
})

// SES-2
test('what was saved comes back on the next run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))
  const file = join(dir, 's.json')

  await saveSession(file, [msg('user', 'what is this'), msg('assistant', 'a monorepo')])

  assert.deepEqual(await loadSession(file), [
    msg('user', 'what is this'),
    msg('assistant', 'a monorepo'),
  ])
})

// SES-5: a half-written or hand-edited file must not take the CLI down.
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
