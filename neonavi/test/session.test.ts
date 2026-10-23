import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { ago, clearAllSessions, clearSession, listSessions, sessionFile, loadSession, saveSession } from '../src/session.ts'

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

// SES-12
test('a history is saved with its directory, and an old bare array still loads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-s-'))
  const file = join(dir, 'sessions', 'aaaaaaaaaaaaaaaa.json')
  await saveSession(file, [msg('user', 'hi')], '/Users/me/project')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).cwd, '/Users/me/project')
  assert.deepEqual(await loadSession(file), [msg('user', 'hi')])
  await writeFile(file, JSON.stringify([msg('user', 'old')]))
  assert.deepEqual(await loadSession(file), [msg('user', 'old')])
})

// SES-13, SES-14
test('histories are listed newest first, and cleared one or all', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-home-'))
  await saveSession(sessionFile('/p/one', home), [msg('user', 'a')], '/p/one')
  await saveSession(sessionFile('/p/two', home), [msg('user', 'a'), msg('assistant', 'b')], '/p/two')
  const old = new Date(Date.now() - 3_600_000)
  await utimes(sessionFile('/p/one', home), old, old)
  await writeFile(join(home, '.neoai', 'sessions', 'notes.txt'), 'not a session')

  const listed = await listSessions(home)
  assert.deepEqual(listed.map((s) => [s.cwd, s.messages]), [['/p/two', 2], ['/p/one', 1]])

  assert.equal(await clearSession('/p/one', home), true)
  assert.equal(await clearSession('/p/one', home), false)
  assert.equal(await clearAllSessions(home), 1)
  assert.deepEqual(await listSessions(home), [])
  // Only session files are touched.
  assert.equal(await readFile(join(home, '.neoai', 'sessions', 'notes.txt'), 'utf8'), 'not a session')
})

test('how long ago reads like a person would say it', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  const before = (min: number) => new Date(now.getTime() - min * 60_000)
  assert.equal(ago(before(0), now), 'just now')
  assert.equal(ago(before(5), now), '5 min ago')
  assert.equal(ago(before(180), now), '3 h ago')
  assert.equal(ago(before(3 * 24 * 60), now), '3 days ago')
})
