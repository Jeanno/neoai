import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// MOD-22
test('a failed link is looked at again after a while; a resolved one is kept', async () => {
  let serving: string[] = []
  const server = createServer((_req, res) => res.end(JSON.stringify({ data: serving.map((id) => ({ id })) })))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const home = await mkdtemp(join(tmpdir(), 'neorouter-memo-'))
  await mkdir(join(home, '.neoai'))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify({ custom: { box: { baseURL } } }))
  const realHome = process.env.HOME
  process.env.HOME = home
  process.env.NEOROUTER_QUIET = '1'
  const { probeBackend, FAILURE_TTL } = await import('../src/resolve.ts')
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const probe = () => probeBackend(undefined, true, 'm1', 'custom', 'box')
    assert.equal(await probe(), null)
    serving = ['m1']
    assert.equal(await probe(), null, 'remembered for now')
    mock.timers.tick(FAILURE_TTL)
    assert.equal((await probe())?.modelId, 'm1')
    serving = []
    mock.timers.tick(FAILURE_TTL)
    assert.equal((await probe())?.modelId, 'm1', 'success is kept')
  } finally {
    mock.timers.reset()
    process.env.HOME = realHome
    server.close()
  }
})
