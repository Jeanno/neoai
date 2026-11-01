import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelMessage } from 'ai'
import type { HarnessEvent, HarnessOptions, Session } from '../src/harness.ts'
import { jobsDir, makeJobs, serveToken, tailnetAddresses, type JobDeps, type Jobs } from '../src/jobs.ts'
import { listen, type ServeDeps } from '../src/serve.ts'

type Approve = NonNullable<HarnessOptions['approve']>

/** A session scripted by its prompt: `ask` waits on an approval, `hang` until stopped, `fail` errors. */
function fakeSession(approve: Approve, start: ModelMessage[]): Session {
  let history = start
  return {
    get history() {
      return history
    },
    async *turn(prompt, { signal } = {}): AsyncGenerator<HarnessEvent> {
      const end = (text: string, o: { stopped?: boolean } = {}): HarnessEvent => {
        history = [...history, { role: 'user', content: prompt }, { role: 'assistant', content: text }]
        return { type: 'done', history, text, empty: !text, stopped: !!o.stopped }
      }
      if (prompt === 'ask') {
        yield { type: 'tool-call', id: 'c1', name: 'run_shell', input: { command: 'rm -rf build' } }
        const ok = await approve('rm -rf build', { signal: signal ?? new AbortController().signal })
        yield { type: 'tool-result', id: 'c1', name: 'run_shell', output: ok ? 'removed' : 'declined', error: false }
        yield end(ok ? 'Removed it.' : 'Left it.', { stopped: !!signal?.aborted })
      } else if (prompt === 'hang') {
        if (!signal?.aborted) await new Promise((r) => signal?.addEventListener('abort', r, { once: true }))
        yield end('', { stopped: true })
      } else if (prompt === 'fail') {
        yield { type: 'error', error: new Error('the backend fell over') }
        yield end('')
      } else {
        yield { type: 'escalated', from: 'small', to: 'big', local: false, reason: 'it gave no answer' }
        yield end(`Answer to ${prompt}.`)
      }
    },
  }
}

async function setup(o: Partial<JobDeps> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'navi-jobs-'))
  const notes: string[] = []
  const pushed: { job: string; urgent?: boolean }[] = []
  const deps: JobDeps = {
    home,
    start: async ({ approve, history }) => ({ session: fakeSession(approve, history), model: 'small' }),
    notify: (title, text, job, urgent) => {
      notes.push(`${title}: ${text}`)
      pushed.push({ job, urgent })
    },
    ...o,
  }
  return { home, notes, pushed, deps, jobs: await makeJobs(deps) }
}

/** Until the job is in that state, or a second has gone. */
async function until(jobs: Jobs, id: string, status: string) {
  for (let i = 0; i < 100 && jobs.get(id)?.status !== status; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(jobs.get(id)?.status, status)
}

// JOB-1, JOB-2, JOB-3, JOB-5
test('a job runs in the background, logs what it did, and can be followed up', async () => {
  const { jobs, notes } = await setup()
  const job = jobs.create('summarise the repo', '/tmp')
  assert.equal(job.status, 'running')
  await jobs.idle()
  const got = jobs.get(job.id)!
  assert.equal(got.status, 'done')
  assert.equal(got.answer, 'Answer to summarise the repo.')
  assert.equal(got.model, 'big')
  assert.deepEqual(got.log, ['· escalated to big (REMOTE): it gave no answer'])
  assert.deepEqual(notes, ['navi is done: summarise the repo'])
  // A follow-up continues the conversation.
  assert.ok(jobs.reply(job.id, 'and the tests'))
  await jobs.idle()
  assert.equal(jobs.get(job.id)!.answer, 'Answer to and the tests.')
  assert.equal(jobs.get(job.id)!.history.length, 4)
  // Listed without the conversation or log (JOB-7).
  assert.deepEqual(Object.keys(jobs.list()[0]).sort(), ['answer', 'created', 'directory', 'id', 'model', 'prompt', 'status', 'updated'])
})

// JOB-4, JOB-5
test('an approval waits in the job until answered', async () => {
  const { jobs, notes, pushed } = await setup()
  const job = jobs.create('ask', '/tmp')
  await until(jobs, job.id, 'waiting')
  assert.deepEqual(jobs.get(job.id)!.pending, { command: 'rm -rf build' })
  assert.deepEqual(notes, ['navi is waiting for you: ask: rm -rf build'])
  // PSH-3: named by the job, and urgent.
  assert.deepEqual(pushed, [{ job: job.id, urgent: true }])
  // A follow-up waits too.
  assert.equal(jobs.reply(job.id, 'more'), false)
  assert.ok(jobs.answer(job.id, true))
  assert.equal(jobs.answer(job.id, true), false)
  await jobs.idle()
  assert.equal(jobs.get(job.id)!.answer, 'Removed it.')
  assert.equal(jobs.get(job.id)!.pending, undefined)
  assert.ok(jobs.get(job.id)!.log.includes('✓ rm -rf build'))
})

// JOB-2, JOB-4
test('a job can be stopped, waiting or not, and fails when its model does', async () => {
  const { jobs } = await setup()
  const waiting = jobs.create('ask', '/tmp')
  await until(jobs, waiting.id, 'waiting')
  assert.ok(jobs.stop(waiting.id))
  const hanging = jobs.create('hang', '/tmp')
  assert.ok(jobs.stop(hanging.id))
  const failing = jobs.create('fail', '/tmp')
  await jobs.idle()
  assert.equal(jobs.get(waiting.id)!.status, 'stopped')
  assert.ok(jobs.get(waiting.id)!.log.includes('✗ rm -rf build'))
  assert.equal(jobs.get(hanging.id)!.status, 'stopped')
  assert.equal(jobs.get(failing.id)!.status, 'failed')
  assert.equal(jobs.get(failing.id)!.error, 'the backend fell over')
  assert.equal(jobs.stop(failing.id), false)
  // No model at all is a failed job too.
  const none = await setup({ start: async () => Promise.reject(new Error('navi has no model to answer with')) })
  const j = none.jobs.create('anything', '/tmp')
  await none.jobs.idle()
  assert.equal(none.jobs.get(j.id)!.status, 'failed')
})

// JOB-6
test('jobs are kept privately on disk, and one running when serve stopped comes back interrupted', async () => {
  const { home, jobs, deps } = await setup()
  const done = jobs.create('first', '/tmp')
  const waiting = jobs.create('ask', '/tmp')
  await until(jobs, waiting.id, 'waiting')
  await until(jobs, done.id, 'done')
  // Written as it changes, with the waiting one still waiting.
  await new Promise((r) => setTimeout(r, 100))
  assert.equal((await stat(jobsDir(home))).mode & 0o777, 0o700)
  assert.equal((await stat(join(jobsDir(home), `${done.id}.json`))).mode & 0o777, 0o600)
  const again = await makeJobs(deps)
  assert.equal(again.get(done.id)!.status, 'done')
  assert.equal(again.get(waiting.id)!.status, 'interrupted')
  assert.equal(again.get(waiting.id)!.pending, undefined)
  // An interrupted job can be followed up.
  assert.ok(again.reply(waiting.id, 'carry on'))
  await again.idle()
  assert.equal(again.get(waiting.id)!.answer, 'Answer to carry on.')
  jobs.stop(waiting.id)
  await jobs.idle()
})

// JOB-6
test('only the 100 most recent jobs are kept', async () => {
  const { home, jobs } = await setup()
  for (let i = 0; i < 103; i++) {
    jobs.create(`job ${i}`, '/tmp')
    // Apart by more than a millisecond, so no two share a creation time.
    await new Promise((r) => setTimeout(r, 3))
  }
  await jobs.idle()
  assert.equal(jobs.list().length, 100)
  assert.equal(jobs.list().at(-1)!.prompt, 'job 3')
  assert.equal((await readdir(jobsDir(home))).filter((n) => n.endsWith('.json')).length, 100)
})

// JOB-8
test('the token is 64 hex characters, private, and the same each time', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-token-'))
  const token = await serveToken(home)
  assert.match(token, /^[0-9a-f]{64}$/)
  assert.equal(await serveToken(home), token)
  assert.equal((await stat(join(home, '.neoai', 'serve-token'))).mode & 0o777, 0o600)
  await writeFile(join(home, '.neoai', 'serve-token'), 'not a token')
  assert.notEqual(await serveToken(home), token)
})

// JOB-10
test("this computer's Tailscale addresses are its IPv4 ones in 100.64.0.0/10", () => {
  const nic = (address: string, family = 'IPv4', internal = false) => ({ address, family, internal, netmask: '', mac: '', cidr: null }) as never
  assert.deepEqual(
    tailnetAddresses({
      lo0: [nic('127.0.0.1', 'IPv4', true)],
      en0: [nic('192.168.1.5'), nic('100.63.0.1')],
      utun4: [nic('100.101.2.3'), nic('fd7a:115c:a1e0::1', 'IPv6')],
      utun5: [nic('100.128.0.1')],
    }),
    ['100.101.2.3'],
  )
})

const noModels: ServeDeps = { route: async () => null, why: async () => 'none', fetch, forget: () => {}, log: () => {} }

/** navi serve with jobs, on loopback and, standing in for the tailnet, IPv6 loopback. */
async function serving() {
  const { jobs, home } = await setup()
  const token = 'a'.repeat(64)
  const servers = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home] }, tailnet: ['::1'] })
  const port = (servers[0].address() as AddressInfo).port
  const remotePort = (servers[1].address() as AddressInfo).port
  const call = (path: string, o: { body?: unknown; token?: string; origin?: string; remote?: boolean } = {}) =>
    fetch(`http://${o.remote ? `[::1]:${remotePort}` : `127.0.0.1:${port}`}${path}`, {
      method: o.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(o.token && { authorization: `Bearer ${o.token}` }),
        ...(o.origin && { origin: o.origin }),
        ...(o.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    })
  return { jobs, home, token, call, close: () => servers.forEach((s) => s.close()) }
}

// JOB-7, JOB-8, JOB-9, JOB-11
test('the jobs API needs the token, lets the page through, and checks what it is given', async (t) => {
  const s = await serving().catch((e) => (e.code === 'EADDRNOTAVAIL' ? null : Promise.reject(e)))
  if (!s) return t.skip('no IPv6 loopback on this computer')
  try {
    assert.equal((await s.call('/jobs')).status, 401)
    assert.equal((await s.call('/jobs', { token: 'b'.repeat(64) })).status, 401)
    const made = await s.call('/jobs', { token: s.token, origin: 'http://100.101.2.3:8484', body: { prompt: 'hello' } })
    assert.equal(made.status, 201)
    const job = await made.json()
    assert.equal(job.directory, s.home)
    await s.jobs.idle()
    const one = await (await s.call(`/jobs/${job.id}`, { token: s.token })).json()
    assert.equal(one.answer, 'Answer to hello.')
    assert.equal((await (await s.call('/jobs', { token: s.token })).json()).jobs.length, 1)
    assert.deepEqual(await (await s.call('/jobs/directories', { token: s.token })).json(), { directories: [s.home] })
    assert.equal((await s.call('/jobs', { token: s.token, body: { prompt: 'x', directory: 'relative/dir' } })).status, 400)
    assert.equal((await s.call('/jobs', { token: s.token, body: { prompt: ' ' } })).status, 400)
    assert.equal((await s.call('/jobs/nope', { token: s.token })).status, 404)
    assert.equal((await s.call(`/jobs/${job.id}/answer`, { token: s.token, body: { yes: true } })).status, 400)
    // SRV-5 still holds for the model endpoints.
    assert.equal((await s.call('/v1/models', { origin: 'http://evil.test' })).status, 403)
  } finally {
    s.close()
  }
})

// JOB-10
test('on the tailnet every request needs the token, and / is the phone page', async (t) => {
  const s = await serving().catch((e) => (e.code === 'EADDRNOTAVAIL' ? null : Promise.reject(e)))
  if (!s) return t.skip('no IPv6 loopback on this computer')
  try {
    assert.equal((await s.call('/v1/models')).status, 200)
    assert.equal((await s.call('/v1/models', { remote: true })).status, 401)
    assert.equal((await s.call('/v1/models', { remote: true, token: s.token })).status, 200)
    const page = await s.call('/', { remote: true })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /<title>navi jobs<\/title>/)
    // The page holds no secret of its own.
    assert.doesNotMatch(html, new RegExp(s.token))
  } finally {
    s.close()
  }
})

// JOB-10: the page is plain script, with no template slips.
test('the phone page script parses', async () => {
  const { PHONE_PAGE } = await import('../src/phone.ts')
  const script = /<script>([\s\S]*)<\/script>/.exec(PHONE_PAGE)![1]
  assert.doesNotThrow(() => new Function(script))
})
