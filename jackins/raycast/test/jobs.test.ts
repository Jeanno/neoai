import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// The real navi serve, so the client is checked against what it answers.
import { makeJobs } from '../../../neonavi/src/jobs.ts'
import { listen, type ServeDeps } from '../../../neonavi/src/serve.ts'
import { actionsFor, detailOf, jobsClient, NotServing, sections, statusWord, type JobRow } from '../src/lib/jobs'

const noModels: ServeDeps = { route: async () => null, why: async () => 'none', fetch, forget: () => {}, log: () => {} }

async function serve() {
  const home = await mkdtemp(join(tmpdir(), 'ray-jobs-'))
  const token = 'r'.repeat(64)
  await mkdir(join(home, '.neoai'), { recursive: true })
  await writeFile(join(home, '.neoai', 'serve-token'), `${token}\n`)
  let down = true
  const jobs = await makeJobs({
    home,
    start: async ({ approve }) => ({
      model: 'small',
      session: {
        history: [],
        async *turn(prompt: string, o: { signal?: AbortSignal } = {}) {
          if (prompt === 'flaky' && down) {
            down = false
            yield { type: 'error', error: new Error('the backend is unreachable') } as const
            yield { type: 'done', history: [], text: '', empty: true, stopped: false } as const
            return
          }
          if (prompt === 'tidy') {
            const yes = await approve('rm -rf build', { signal: o.signal ?? new AbortController().signal })
            yield { type: 'done', history: [], text: yes ? 'Removed it.' : 'Left it.', empty: false, stopped: false } as const
            return
          }
          yield { type: 'done', history: [], text: `Answer to ${prompt}.`, empty: false, stopped: false } as const
        },
      },
    }),
    notify: () => {},
  })
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const port = (server.address() as AddressInfo).port
  return { home, jobs, server, client: jobsClient({ home, port }) }
}

const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await check()); i++) await new Promise((r) => setTimeout(r, 20))
  assert.ok(await check())
}

test('RAY-15, RAY-16: jobs are listed, answered, tried again and started through navi serve', async (t) => {
  const { client, server, home } = await serve()
  t.after(() => server.close())
  const started = await client.start('tidy')
  assert.equal(started.directory, home)
  await until(async () => (await client.list())[0].status === 'waiting')
  const [waiting] = await client.list()
  assert.equal(waiting.pending?.command, 'rm -rf build')
  assert.deepEqual(actionsFor(waiting), { allow: true, copy: false, retry: false, stop: true })
  assert.match(detailOf(waiting), /### navi asks to\n\n```\nrm -rf build\n```/)
  await client.answer(waiting.id, true)
  await until(async () => (await client.list())[0].status === 'done')
  assert.equal((await client.list())[0].answer, 'Removed it.')
  await client.start('flaky')
  await until(async () => (await client.list()).some((j) => j.status === 'failed'))
  const failed = (await client.list()).find((j) => j.status === 'failed')!
  assert.ok(actionsFor(failed).retry)
  assert.match(detailOf(failed), /\*\*Failed:\*\* the backend is unreachable/)
  await client.retry(failed.id)
  await until(async () => (await client.list()).find((j) => j.id === failed.id)!.status === 'done')
  // What navi serve refuses is said as it says it.
  await assert.rejects(client.retry(failed.id), /Only a job that failed or was interrupted/)
  await assert.rejects(client.start('  '), /Give the job a prompt/)
})

test('RAY-17: no navi serve, or no token, is said as not running, and no token is made', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ray-jobs-'))
  await assert.rejects(jobsClient({ home, port: 1 }).list(), NotServing)
  await assert.equal((await readdir(home)).length, 0)
  await mkdir(join(home, '.neoai'))
  await writeFile(join(home, '.neoai', 'serve-token'), 'x'.repeat(64))
  await assert.rejects(jobsClient({ home, port: 1 }).list(), NotServing)
})

test('RAY-15: waiting first, then working, then the rest, newest first; a fence no answer can close', () => {
  const j = (id: string, status: JobRow['status'], created: string): JobRow => ({ id, prompt: id, directory: '/d', created, status })
  const got = sections([j('a', 'done', '1'), j('b', 'waiting', '2'), j('c', 'running', '3'), j('d', 'failed', '4'), j('e', 'queued', '5')])
  assert.deepEqual(
    got.map((s) => [s.title, s.jobs.map((x) => x.id)]),
    [
      ['Needs You', ['b']],
      ['Working', ['e', 'c']],
      ['Recent', ['d', 'a']],
    ],
  )
  assert.equal(statusWord({ status: 'done', unchanged: true }), 'Nothing new')
  const tricky: JobRow = { ...j('x', 'waiting', '1'), pending: { command: 'echo ```done```' } }
  assert.match(detailOf(tricky), /````\necho ```done```\n````/)
})
