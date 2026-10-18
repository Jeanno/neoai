import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { darkbloomServer } from '../src/discover.ts'

async function homeWith(localJson?: string) {
  const home = await mkdtemp(join(tmpdir(), 'neorouter-darkbloom-'))
  if (localJson !== undefined) {
    await mkdir(join(home, '.darkbloom'))
    await writeFile(join(home, '.darkbloom', 'local.json'), localJson)
  }
  return home
}

test('reads the endpoint and key that `darkbloom start --local` writes', async () => {
  const home = await homeWith(
    JSON.stringify({ api_key: 'secret', base_url: 'http://100.64.0.1:8000/v1', port: 8000 }),
  )
  assert.deepEqual(await darkbloomServer(home), {
    backend: 'darkbloom',
    baseURL: 'http://100.64.0.1:8000/v1',
    auth: 'secret',
  })
})

test('drops a trailing slash so paths join cleanly', async () => {
  const home = await homeWith(JSON.stringify({ base_url: 'http://127.0.0.1:8000/v1/' }))
  assert.equal((await darkbloomServer(home))?.baseURL, 'http://127.0.0.1:8000/v1')
})

test('omits auth when no key is recorded', async () => {
  const home = await homeWith(JSON.stringify({ base_url: 'http://127.0.0.1:8000/v1' }))
  assert.equal((await darkbloomServer(home))?.auth, undefined)
})

test('is absent when darkbloom has never run locally', async () => {
  assert.equal(await darkbloomServer(await homeWith()), null)
})

test('is absent when the file is malformed or has no URL', async () => {
  assert.equal(await darkbloomServer(await homeWith('{not json')), null)
  assert.equal(await darkbloomServer(await homeWith(JSON.stringify({ api_key: 'k' }))), null)
})
