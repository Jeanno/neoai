import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configDir, readKey, sessionsDir } from '../src/config.ts'

// One app directory, the way ~/.claude and ~/.codex do it: history is the part
// you actually want to find, and splitting it across XDG dirs hides it.
test('everything lives in one directory under home', () => {
  assert.equal(configDir('/home/me'), '/home/me/.neoai')
})

test('sessions sit beside the config, not in a separate tree', () => {
  assert.equal(sessionsDir('/home/me'), '/home/me/.neoai/sessions')
})

test('an environment variable wins over the config file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-cfg-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify({ openrouterKey: 'from-file' }))

  assert.equal(await readKey('openrouterKey', dir, { OPENROUTER_API_KEY: 'from-env' }), 'from-env')
})

test('falls back to the config file when the variable is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-cfg-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify({ openrouterKey: 'from-file' }))

  assert.equal(await readKey('openrouterKey', dir, {}), 'from-file')
})

test('no key anywhere is null, not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-cfg-'))

  assert.equal(await readKey('openrouterKey', dir, {}), null)
})

test('a corrupt config file reads as no key rather than throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-cfg-'))
  await writeFile(join(dir, 'config.json'), '{oops')

  assert.equal(await readKey('openrouterKey', dir, {}), null)
})
