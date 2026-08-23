import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectContext } from '../src/context.ts'

async function monorepo() {
  const root = await mkdtemp(join(tmpdir(), 'navi-c-'))
  await mkdir(join(root, '.git'))
  await mkdir(join(root, 'pkg'))
  await writeFile(join(root, 'NAVI.md'), 'ROOT: a monorepo of two packages.')
  await writeFile(join(root, 'pkg', 'NAVI.md'), 'PKG: the cli.')
  return root
}

test('reads the context file sitting in the working directory', async () => {
  const root = await monorepo()

  assert.match(await collectContext(root), /ROOT: a monorepo/)
})

test('collects the package file and the repo root file, root first', async () => {
  const root = await monorepo()

  const out = await collectContext(join(root, 'pkg'))

  assert.match(out, /ROOT: a monorepo/)
  assert.match(out, /PKG: the cli/)
  assert.ok(out.indexOf('ROOT:') < out.indexOf('PKG:'))
})

test('stops climbing at the repo root', async () => {
  // A NAVI.md above the repo belongs to a different project.
  const outer = await mkdtemp(join(tmpdir(), 'navi-c-'))
  await writeFile(join(outer, 'NAVI.md'), 'OUTSIDE: not ours.')
  const repo = join(outer, 'repo')
  await mkdir(join(repo, '.git'), { recursive: true })
  await writeFile(join(repo, 'NAVI.md'), 'ROOT: ours.')

  const out = await collectContext(repo)

  assert.match(out, /ROOT: ours/)
  assert.doesNotMatch(out, /OUTSIDE/)
})

test('a project with no context file is silent, not an error', async () => {
  const bare = await mkdtemp(join(tmpdir(), 'navi-c-'))

  assert.equal(await collectContext(bare), '')
})

test('caps the total so a huge file cannot crowd out the conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'navi-c-'))
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'NAVI.md'), 'x'.repeat(20_000))

  const out = await collectContext(root)

  assert.ok(out.length <= 8200, `expected a cap, got ${out.length}`)
})
