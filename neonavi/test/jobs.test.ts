import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { readMemory } from '../src/memory.ts'
import { readUndone } from '../src/ledger.ts'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelMessage } from 'ai'
import type { HarnessEvent, HarnessOptions, Session } from '../src/harness.ts'
import { jobsDir, makeJobs, matches, serveToken, tailnetAddresses, type JobDeps, type Jobs } from '../src/jobs.ts'
import { listen, type ServeDeps } from '../src/serve.ts'
import { makeRecorder } from '../src/undo.ts'
import { userContent } from '../src/attach.ts'

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
      } else if (prompt === 'edit' || prompt === 'click') {
        const o = prompt === 'edit'
          ? { change: { path: 'a.ts', created: false, diff: '@@ line 1 @@\n  keep\n- old\n+ new', added: 1, removed: 1 } }
          : { action: { url: 'https://shop.example/cart?id=7', shot: async () => Buffer.from('the cart, as a jpeg') } }
        const ok = await approve(prompt === 'edit' ? 'edit a.ts (+1 -1)' : 'click "Buy now"', { signal: signal ?? new AbortController().signal, ...o })
        yield end(ok ? 'Did it.' : 'Left it.')
      } else if (prompt === 'long') {
        history = [...history, { role: 'user', content: prompt }, { role: 'assistant', content: 'Once upon' }]
        yield { type: 'done', history, text: 'Once upon', empty: false, stopped: false, cut: true }
      } else if (prompt === 'hang') {
        if (!signal?.aborted) await new Promise((r) => signal?.addEventListener('abort', r, { once: true }))
        yield end('', { stopped: true })
      } else if (prompt === 'fail') {
        yield { type: 'error', error: new Error('the backend fell over') }
        yield end('')
      } else if (prompt === 'nothing-new') {
        yield end('NOTHING NEW.')
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
  const keys: string[] = []
  const deps: JobDeps = {
    home,
    start: async ({ approve, history }) => ({ session: fakeSession(approve, history), model: 'small' }),
    notify: (title, text, job, urgent, key) => {
      notes.push(`${title}: ${text}`)
      pushed.push({ job, urgent })
      if (key) keys.push(key)
    },
    ...o,
  }
  return { home, notes, pushed, keys, deps, jobs: await makeJobs(deps) }
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

// SCH-10, SCH-11
test('a watch that finds nothing new is marked so and says nothing; one with news is notified', async () => {
  const { jobs, notes } = await setup({
    start: async ({ approve, history }) => ({ session: fakeSession(approve, history), model: 'small' }),
  })
  const quietJob = jobs.create('check the page', '/tmp', { schedule: 's1', watch: true, send: 'nothing-new' })
  await jobs.idle()
  assert.equal(jobs.get(quietJob.id)?.prompt, 'check the page')
  assert.equal(jobs.get(quietJob.id)?.status, 'done')
  assert.equal(jobs.get(quietJob.id)?.unchanged, true)
  assert.deepEqual(notes, [])
  const news = jobs.create('check the page', '/tmp', { schedule: 's1', watch: true, send: 'news' })
  await jobs.idle()
  assert.equal(jobs.get(news.id)?.unchanged, undefined)
  assert.deepEqual(notes, ['navi is done: check the page'])
  // Not a watch: NOTHING NEW is just an answer.
  const plain = jobs.create('check the page', '/tmp', { send: 'nothing-new' })
  await jobs.idle()
  assert.equal(jobs.get(plain.id)?.unchanged, undefined)
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
  const servers = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home }, tailnet: ['::1'] })
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
    assert.match(html, /<title>navi<\/title>/)
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

// UND-10, UND-11, UND-12
test("a finished job's changes are listed and undone through the API, never while it runs", async () => {
  const { jobs, home } = await setup()
  const dir = await mkdtemp(join(tmpdir(), 'navi-jobs-dir-'))
  const token = 'e'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [dir], home } })
  const call = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const running = jobs.create('hang', dir)
    assert.equal((await call(`/jobs/${running.id}/undo`, {})).status, 400)
    jobs.stop(running.id)

    const job = jobs.create('tidy', dir)
    await jobs.idle()
    // What the job's turn wrote, as the harness records it, and another job's.
    await writeFile(join(dir, 'a.txt'), 'navi wrote this')
    const r = makeRecorder(home, dir, 'tidy', undefined, job.id)
    r.wrote(join(dir, 'a.txt'), 'mine', 'navi wrote this')
    r.ran('make clean')
    r.answeredBy('small on Darkbloom')
    await r.saved()
    const other = makeRecorder(home, dir, 'other', () => new Date(Date.now() + 1000), 'someone-else')
    await writeFile(join(dir, 'b.txt'), 'other')
    other.wrote(join(dir, 'b.txt'), null, 'other')
    await other.saved()

    assert.deepEqual((await (await call(`/jobs/${job.id}`)).json()).changes, ['a.txt'])
    const undone = await call(`/jobs/${job.id}/undo`, {})
    assert.equal(undone.status, 200)
    const body = await undone.json()
    assert.deepEqual(body, {
      restored: ['a.txt'], removed: [], left: [], big: [], commands: ['make clean'],
      lines: ['put back a.txt', 'not undone, what this did: $ make clean'],
    })
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'mine')
    // LED-9: the ledger hears whose turn was undone, and nothing else.
    assert.deepEqual(await readUndone(home), ['small on Darkbloom'])
    // The other job's file is untouched.
    assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'other')
    const after = await (await call(`/jobs/${job.id}`)).json()
    assert.deepEqual(after.changes, [])
    assert.deepEqual(after.log.slice(-3), ['↶ undone:', '  put back a.txt', '  not undone, what this did: $ make clean'])
    assert.equal((await call(`/jobs/${job.id}/undo`, {})).status, 400)
  } finally {
    server.close()
    await jobs.idle()
  }
})

// PSH-8, PSH-10
test("a notification's key answers its own approval once, without the token, and is never logged", async () => {
  const { jobs, home, keys } = await setup()
  const token = 'g'.repeat(64)
  const logged: string[] = []
  const [server] = await listen([], { ...noModels, log: (l) => logged.push(l) }, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const answer = (path: string, body: string) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method: 'POST', body })
  try {
    const job = jobs.create('ask', '/tmp')
    await until(jobs, job.id, 'waiting')
    const [key] = keys
    assert.match(key, /^[0-9a-f]{32}$/)
    // Never in what the jobs API shows.
    assert.doesNotMatch(JSON.stringify(jobs.get(job.id)), new RegExp(key))
    assert.equal((await answer(`/answer/${job.id}/${'0'.repeat(32)}`, 'yes')).status, 403)
    assert.equal((await answer(`/answer/${job.id}/${key}`, 'maybe')).status, 400)
    assert.equal(jobs.get(job.id)!.status, 'waiting')
    const ok = await answer(`/answer/${job.id}/${key}`, 'yes')
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { answered: 'yes' })
    await jobs.idle()
    assert.equal(jobs.get(job.id)!.answer, 'Removed it.')
    assert.ok(jobs.get(job.id)!.log.includes('✓ rm -rf build'))
    // Once only.
    assert.equal((await answer(`/answer/${job.id}/${key}`, 'no')).status, 403)
    await new Promise((r) => setTimeout(r, 50))
    assert.ok(logged.some((l) => l.includes(`/answer/${job.id}/…`) && l.includes('answer by key')))
    assert.ok(!logged.some((l) => l.includes(key)))
  } finally {
    server.close()
  }
})

// JOB-14, JOB-15
test('a job can be given files, which go with its first turn and are named on it, never sent back', async () => {
  const given: unknown[] = []
  const { jobs, home } = await setup({
    start: async ({ approve, history }) => {
      const session = fakeSession(approve, history)
      return { session: { ...session, get history() { return session.history }, turn: (p, o) => (given.push(o?.attachments), session.turn(p, o)) }, model: 'small' }
    },
  })
  const token = 'h'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const call = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const bad = await call('/jobs', { prompt: 'read it', files: [{ name: 'blob.bin', data: Buffer.from([0, 255]).toString('base64') }] })
    assert.equal(bad.status, 400)
    assert.match((await bad.json()).error.message, /blob\.bin/)
    assert.equal(jobs.list().length, 0)

    const made = await call('/jobs', { prompt: 'what does it say', files: [{ name: 'note.txt', data: Buffer.from('call the plumber').toString('base64') }] })
    assert.equal(made.status, 201)
    const job = await made.json()
    assert.deepEqual(job.files, ['note.txt'])
    await jobs.idle()
    assert.deepEqual(given, [[{ kind: 'text', name: 'note.txt', text: 'call the plumber' }]])
    const one = await (await call(`/jobs/${job.id}`)).json()
    assert.deepEqual(one.files, ['note.txt'])
    assert.equal(one.history, undefined)
    assert.ok(jobs.get(job.id)!.history.length > 0)
  } finally {
    server.close()
  }
})

// JOB-37
test("a turn's photos are named in its turns and can be had one by one, with the token; other files cannot", async () => {
  const { jobs, home } = await setup({
    start: async ({ history }) => {
      let h = history
      return {
        model: 'small',
        session: {
          get history() { return h },
          async *turn(prompt: string, o: any) {
            h = [...h, { role: 'user', content: userContent(prompt, o?.attachments) } as ModelMessage, { role: 'assistant', content: 'A dot.' }]
            yield { type: 'done', history: h, text: 'A dot.', empty: false, stopped: false } as const
          },
        } as Session,
      }
    },
  })
  const token = 'b'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (path: string, body?: unknown, auth = true) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
  try {
    const job = await (await call('/jobs', { prompt: 'what is this', files: [{ name: 'note.txt', data: Buffer.from('hi').toString('base64') }, { name: 'dot.png', data: png.toString('base64') }] })).json()
    await jobs.idle()
    const one = await (await call(`/jobs/${job.id}`)).json()
    assert.deepEqual(one.turns, [{ prompt: 'what is this', files: ['note.txt', 'dot.png'], images: ['dot.png'], answer: 'A dot.' }])
    const got = await call(`/jobs/${job.id}/turns/0/images/0`)
    assert.equal(got.status, 200)
    assert.equal(got.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), png)
    assert.equal((await call(`/jobs/${job.id}/turns/0/images/1`)).status, 404)
    assert.equal((await call(`/jobs/${job.id}/turns/1/images/0`)).status, 404)
    assert.equal((await call(`/jobs/${job.id}/turns/0/images/0`, undefined, false)).status, 401)
  } finally {
    server.close()
  }
})

// JOB-19
test('a follow-up can carry files too, all of them or no follow-up', async () => {
  const given: unknown[] = []
  const { jobs, home } = await setup({
    start: async ({ approve, history }) => {
      const session = fakeSession(approve, history)
      return { session: { ...session, get history() { return session.history }, turn: (p, o) => (given.push(o?.attachments), session.turn(p, o)) }, model: 'small' }
    },
  })
  const token = 'i'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const call = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const file = (name: string, text: string) => ({ name, data: Buffer.from(text).toString('base64') })
  try {
    const job = await (await call('/jobs', { prompt: 'plan the week', files: [file('a.txt', 'monday')] })).json()
    await jobs.idle()
    const bad = await call(`/jobs/${job.id}/reply`, { prompt: 'and this', files: [{ name: 'blob.bin', data: Buffer.from([0, 255]).toString('base64') }] })
    assert.equal(bad.status, 400)
    assert.match((await bad.json()).error.message, /blob\.bin/)
    assert.equal(given.length, 1)
    assert.equal(jobs.get(job.id)!.status, 'done')

    const ok = await call(`/jobs/${job.id}/reply`, { prompt: 'add these', files: [file('b.txt', 'tuesday'), file('c.txt', 'wednesday')] })
    assert.equal(ok.status, 200)
    await jobs.idle()
    assert.deepEqual(given[1], [
      { kind: 'text', name: 'b.txt', text: 'tuesday' },
      { kind: 'text', name: 'c.txt', text: 'wednesday' },
    ])
    const after = jobs.get(job.id)!
    assert.deepEqual(after.files, ['a.txt', 'b.txt', 'c.txt'])
    assert.ok(after.log.includes('> add these (with b.txt, c.txt)'))

    // A plain follow-up still goes with none.
    assert.equal((await call(`/jobs/${job.id}/reply`, { prompt: 'thanks' })).status, 200)
    await jobs.idle()
    assert.equal(given[2], undefined)
  } finally {
    server.close()
  }
})

// JOB-21, JOB-22
test('past the jobs allowed at once, the rest queue and run in order; one waiting on you holds no place', async () => {
  const order: string[] = []
  const { jobs, home } = await setup({
    atOnce: 1,
    start: async ({ approve, history }) => {
      const session = fakeSession(approve, history)
      return { session: { ...session, get history() { return session.history }, turn: (p, o) => (order.push(p), session.turn(p, o)) }, model: 'small' }
    },
  })
  const first = jobs.create('hang', '/tmp')
  const second = jobs.create('two', '/tmp')
  const third = jobs.create('three', '/tmp')
  assert.equal(first.status, 'running')
  assert.equal(second.status, 'queued')
  assert.equal(third.status, 'queued')
  assert.ok(second.log.includes('· queued: next, as 1 run at once'))
  assert.ok(third.log.includes('· queued: 1 ahead of it, as 1 run at once'))

  // Queued is working: no follow-up, and stopping takes it out unrun.
  assert.equal(jobs.reply(third.id, 'more'), false)
  assert.ok(jobs.stop(third.id))
  assert.equal(jobs.get(third.id)!.status, 'stopped')

  jobs.stop(first.id)
  await jobs.idle()
  assert.equal(jobs.get(second.id)!.status, 'done')
  assert.deepEqual(order, ['hang', 'two'])

  // A job asking you frees its place; answered, it goes on beside the next.
  const asking = jobs.create('ask', '/tmp')
  await until(jobs, asking.id, 'waiting')
  const next = jobs.create('after', '/tmp')
  await until(jobs, next.id, 'done')
  assert.ok(jobs.answer(asking.id, true))
  await jobs.idle()
  assert.equal(jobs.get(asking.id)!.status, 'done')

  // Queued when serve stops: interrupted on the way back (JOB-6).
  const again = await makeJobs({ home, atOnce: 1, start: async () => new Promise(() => {}), notify: () => {} })
  again.create('stuck', '/tmp')
  const waits = again.create('behind', '/tmp')
  assert.equal(waits.status, 'queued')
  await new Promise((r) => setTimeout(r, 50))
  const back = await makeJobs({ home, start: async () => { throw new Error('unused') }, notify: () => {} })
  assert.equal(back.get(waits.id)!.status, 'interrupted')
})

// JOB-21
test('the jobs allowed at once is 2 unless the config gives a whole number from 1', async () => {
  for (const [atOnce, want] of [[undefined, 2], [0, 2], [1.5, 2], [3, 3]] as const) {
    const { jobs } = await setup({ atOnce, start: async () => new Promise(() => {}) })
    const made = Array.from({ length: 4 }, () => jobs.create('x', '/tmp'))
    assert.equal(made.filter((j) => j.status === 'running').length, want, `atOnce ${atOnce}`)
  }
})

// JOB-40
test('what the Mac and the phone are told can be read and set through the API, with the token', async () => {
  const { jobs, home } = await setup()
  const token = 's'.repeat(64)
  const file = join(home, '.neoai', 'config.json')
  await mkdir(join(home, '.neoai'), { recursive: true })
  await writeFile(file, JSON.stringify({ model: 'm' }))
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const call = (body?: unknown, auth = true) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/settings/notify`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    assert.equal((await call(undefined, false)).status, 401)
    assert.equal((await call({ mac: 'off' }, false)).status, 401)
    assert.deepEqual(await (await call()).json(), { mac: 'all', phone: null })
    const noPush = await call({ mac: 'off', phone: 'waiting' })
    assert.equal(noPush.status, 400)
    assert.match((await noPush.json()).error.message, /No push is set up/)
    assert.equal((await call({ mac: 'quiet' })).status, 400)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { model: 'm' })
    assert.deepEqual(await (await call({ mac: 'waiting' })).json(), { mac: 'waiting', phone: null })
    await writeFile(file, JSON.stringify({ model: 'm', notify: 'waiting', push: 'https://ntfy.sh/t' }))
    assert.deepEqual(await (await call({ phone: 'off' })).json(), { mac: 'waiting', phone: 'off' })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { model: 'm', notify: 'waiting', push: { url: 'https://ntfy.sh/t', notify: false } })
  } finally {
    server.close()
  }
})

// MEM-12
test('memory can be read, added to and forgotten through the API, with the token, by exact text', async () => {
  const { jobs, home } = await setup()
  const token = 'm'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const call = (path: string, body?: unknown, auth = true) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    assert.equal((await call('/memory', undefined, false)).status, 401)
    assert.deepEqual(await (await call('/memory')).json(), { facts: [], off: false, projects: [] })
    const added = await call('/memory', { fact: 'Keeps bees' })
    assert.equal(added.status, 201)
    assert.deepEqual((await added.json()).facts, ['Keeps bees'])
    await call('/memory', { fact: 'Keeps bees and chickens' })
    const dup = await call('/memory', { fact: 'keeps  BEES' })
    assert.equal(dup.status, 400)
    assert.match((await dup.json()).error.message, /already/)
    assert.equal((await call('/memory', { fact: 'two\nlines' })).status, 400)
    // Exact text only: "Keeps bees" is not "Keeps bees and chickens".
    const gone = await call('/memory/forget', { fact: 'Keeps bees' })
    assert.deepEqual((await gone.json()).facts, ['Keeps bees and chickens'])
    assert.equal((await call('/memory/forget', { fact: 'Keeps bees' })).status, 404)
    assert.equal(await readFile(join(home, '.neoai', 'memory.md'), 'utf8'), '- Keeps bees and chickens\n')
  } finally {
    server.close()
  }
  const [off] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home, memory: false } })
  try {
    const got = await fetch(`http://127.0.0.1:${(off.address() as AddressInfo).port}/memory`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal((await got.json()).off, true)
  } finally {
    off.close()
  }
})

// MEM-18
test("a project's facts can be read, added to and forgotten through the API, for offered projects only", async () => {
  const { jobs, home } = await setup()
  const repo = join(home, 'app')
  await mkdir(join(repo, '.git'), { recursive: true })
  await mkdir(join(repo, 'web'))
  const token = 'p'.repeat(64)
  // Two directories in one repository are one project; home has none.
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [join(repo, 'web'), repo, home], home } })
  const call = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    assert.deepEqual((await (await call('/memory')).json()).projects, [{ root: repo, facts: [] }])
    const added = await call('/memory', { fact: 'Tests run with make check', project: repo })
    assert.equal(added.status, 201)
    assert.deepEqual(await added.json(), { facts: [], off: false, projects: [{ root: repo, facts: ['Tests run with make check'] }] })
    assert.deepEqual(await readMemory(home, repo), ['Tests run with make check'])
    assert.equal((await call('/memory', { fact: 'tests run with  MAKE check', project: repo })).status, 400)
    for (const project of [join(home, 'elsewhere'), join(repo, 'web'), 7]) {
      const no = await call('/memory', { fact: 'x', project })
      assert.equal(no.status, 400)
      assert.match((await no.json()).error.message, /not a project navi serve offers/)
    }
    // The user's facts are not a project's.
    assert.equal((await call('/memory/forget', { fact: 'Tests run with make check' })).status, 404)
    const gone = await call('/memory/forget', { fact: 'Tests run with make check', project: repo })
    assert.deepEqual((await gone.json()).projects, [{ root: repo, facts: [] }])
  } finally {
    server.close()
  }
})

// HAR-11
test("a job whose answer was cut at the token cap says so in its log", async () => {
  const { jobs } = await setup()
  const job = jobs.create('long', '/tmp')
  await jobs.idle()
  assert.equal(jobs.get(job.id)!.status, 'done')
  assert.match(jobs.get(job.id)!.log.join('\n'), /· cut short: the answer reached the model’s token cap/)
})

// JOB-35
test('a cut job is marked so until it runs again', async () => {
  const { jobs } = await setup()
  const job = jobs.create('long', '/tmp')
  await jobs.idle()
  assert.equal(jobs.get(job.id)!.cut, true)
  jobs.reply(job.id, 'Go on from where you stopped.')
  await jobs.idle()
  assert.equal(jobs.get(job.id)!.cut, undefined)
})

// LED-7
test("a follow-up's session is told whose answer it follows, and when", async () => {
  const seen: unknown[] = []
  const { jobs } = await setup({
    start: async ({ approve, history, answered }) => (seen.push(answered), { session: fakeSession(approve, history), model: 'small' }),
  })
  const job = jobs.create('summarise the repo', '/tmp')
  await jobs.idle()
  const at = Date.parse(jobs.get(job.id)!.updated)
  jobs.reply(job.id, 'no, the other repo')
  await jobs.idle()
  jobs.create('fail', '/tmp')
  await jobs.idle()
  const failed = jobs.list().find((j) => j.status === 'failed')!
  jobs.reply(failed.id, 'try again')
  await jobs.idle()
  // The model that answered (it escalated to big); nothing before the first turn, nor after a failure.
  assert.deepEqual(seen, [undefined, { model: 'big', at }, undefined, undefined])
})

// PSH-14, PSH-15
test("a waiting change's notification shows its changed lines, and an action's its page", async () => {
  const { jobs, notes } = await setup()
  const edit = jobs.create('edit', '/tmp')
  await until(jobs, edit.id, 'waiting')
  assert.deepEqual(notes, ['navi is waiting for you: edit: edit a.ts (+1 -1)\n- old\n+ new'])
  jobs.answer(edit.id, true)
  const click = jobs.create('click', '/tmp')
  await until(jobs, click.id, 'waiting')
  assert.equal(notes[1], 'navi is waiting for you: click: click "Buy now"\non shop.example/cart')
  jobs.answer(click.id, false)
  await jobs.idle()
})

// PSH-17
test('a job waiting on a browser action has a picture of the page, with the token, until it is answered', async () => {
  const { jobs, home } = await setup()
  const token = 'c'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const get = (path: string, auth = true) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers: auth ? { authorization: `Bearer ${token}` } : {} })
  try {
    const edit = jobs.create('edit', '/tmp')
    await until(jobs, edit.id, 'waiting')
    // A file change has no page.
    assert.equal(jobs.get(edit.id)!.pending!.shot, undefined)
    assert.equal((await get(`/jobs/${edit.id}/page.jpg`)).status, 404)
    jobs.answer(edit.id, true)
    const click = jobs.create('click', '/tmp')
    await until(jobs, click.id, 'waiting')
    while (!jobs.get(click.id)!.pending?.shot) await new Promise((r) => setTimeout(r, 5))
    const got = await get(`/jobs/${click.id}/page.jpg`)
    assert.equal(got.status, 200)
    assert.equal(got.headers.get('content-type'), 'image/jpeg')
    assert.equal(await got.text(), 'the cart, as a jpeg')
    assert.equal((await get(`/jobs/${click.id}/page.jpg`, false)).status, 401)
    // Never written down with the job.
    const saved = await readFile(join(jobsDir(home), `${click.id}.json`), 'utf8')
    assert.ok(!saved.includes('the cart'))
    jobs.answer(click.id, false)
    await jobs.idle()
    assert.equal((await get(`/jobs/${click.id}/page.jpg`)).status, 404)
    assert.equal(jobs.shot(click.id), undefined)
  } finally {
    server.close()
  }
})

// JOB-24, JOB-25
test('a finished job can be deleted, for good, and clear deletes all those not working', async () => {
  const { jobs, home } = await setup()
  const token = 'd'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const call = (path: string) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })
  try {
    const one = jobs.create('one', '/tmp')
    const two = jobs.create('two', '/tmp')
    await jobs.idle()
    const hanging = jobs.create('hang', '/tmp')
    assert.equal((await call(`/jobs/${hanging.id}/delete`)).status, 400)

    const del = await call(`/jobs/${one.id}/delete`)
    assert.deepEqual(await del.json(), { deleted: one.id })
    assert.equal(jobs.get(one.id), undefined)
    assert.equal((await call(`/jobs/${one.id}/delete`)).status, 404)

    assert.deepEqual(await (await call('/jobs/clear')).json(), { cleared: 1 })
    assert.equal(jobs.get(two.id), undefined)
    assert.ok(jobs.get(hanging.id))
    // Gone from disk too, so a restart does not bring them back.
    const again = await makeJobs({ home, start: async () => { throw new Error('unused') }, notify: () => {} })
    assert.deepEqual(again.list().map((j) => j.id), [hanging.id])
    jobs.stop(hanging.id)
    await jobs.idle()
  } finally {
    server.close()
  }
})

// JOB-27
test('a job lists its turns, a follow-up still running included, never its conversation', async () => {
  const { jobs, home } = await setup()
  const token = 't'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const get = async (id: string) =>
    (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/jobs/${id}`, { headers: { authorization: `Bearer ${token}` } })).json()
  try {
    const job = jobs.create('first question', '/tmp')
    await jobs.idle()
    assert.deepEqual((await get(job.id)).turns, [{ prompt: 'first question', answer: 'Answer to first question.' }])
    assert.ok(jobs.reply(job.id, 'hang'))
    await until(jobs, job.id, 'running')
    const running = await get(job.id)
    assert.deepEqual(running.turns, [{ prompt: 'first question', answer: 'Answer to first question.' }, { prompt: 'hang' }])
    assert.equal(running.history, undefined)
    jobs.stop(job.id)
    await jobs.idle()
    assert.deepEqual((await get(job.id)).turns.at(-1), { prompt: 'hang' })
  } finally {
    server.close()
  }
})

test('JOB-30: a job matches when it holds every word, in any case, in its prompt, answer, error or status', () => {
  const job = { prompt: 'Check the Backups', status: 'failed' as const, answer: 'Disk is nearly full', error: 'timed out' }
  assert.ok(matches(job, 'backups'))
  assert.ok(matches(job, 'DISK   check'))
  assert.ok(matches(job, 'timed failed'))
  assert.ok(!matches(job, 'backups printer'))
  assert.ok(matches({ prompt: 'x', status: 'done' }, '  '))
})

test('SCH-28: a second try says which job it tries again', async () => {
  const home = await mkdtemp(join(tmpdir(), 'navi-jobs-'))
  const jobs = await makeJobs({ home, start: async () => { throw new Error('no model') }, notify: () => {} })
  const job = jobs.create('the brief', home, { schedule: 'abc', retry: 'deadbeef' })
  await jobs.idle()
  const got = jobs.get(job.id)!
  assert.equal(got.retryOf, 'deadbeef')
  assert.equal(got.log[0], '· trying again: job deadbeef failed')
})

// MEM-23, MEM-24
test('a finished job offers suggestions on asking, with project facts only for an offered project', async () => {
  const { jobs, home } = await setup()
  const repo = join(home, 'app')
  await mkdir(join(repo, '.git'), { recursive: true })
  const elsewhere = join(home, 'other')
  await mkdir(join(elsewhere, '.git'), { recursive: true })
  const token = 's'.repeat(64)
  const seen: { history: ModelMessage[]; known: { you: string[]; project?: string[] } }[] = []
  const suggest = async (history: ModelMessage[], known: { you: string[]; project?: string[] }) => {
    seen.push({ history, known })
    return [{ fact: 'Prefers tabs', project: false }, { fact: 'Tests run with make check', project: true }]
  }
  const serve = async (memory?: boolean, withSuggest = true) => {
    const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [repo, home], home, memory, ...(withSuggest && { suggest }) } })
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: r.status, body: await r.json() }
    }
    return { server, call }
  }
  const here = jobs.create('hello', repo)
  const there = jobs.create('hello', elsewhere)
  const busy = jobs.create('hang', repo)
  await until(jobs, here.id, 'done')
  await until(jobs, there.id, 'done')
  const { server, call } = await serve()
  try {
    assert.equal((await call(`/jobs/${here.id}`)).body.suggests, true)
    assert.equal((await call(`/jobs/${busy.id}`)).body.suggests, undefined)
    // Nothing is asked until asked for.
    assert.equal(seen.length, 0)
    const got = await call(`/jobs/${here.id}/suggest`, {})
    assert.deepEqual(got.body, { suggestions: [{ fact: 'Prefers tabs' }, { fact: 'Tests run with make check', project: repo }] })
    assert.deepEqual(seen[0].known, { you: [], project: [] })
    assert.ok(seen[0].history.some((m) => m.role === 'user' && m.content === 'hello'))
    // Nothing is kept by suggesting it.
    assert.deepEqual(await readMemory(home), [])
    // The suggested project is one POST /memory takes.
    assert.equal((await call('/memory', { fact: 'Tests run with make check', project: repo })).status, 201)
    // A project navi serve does not offer has no project facts suggested.
    const other = await call(`/jobs/${there.id}/suggest`, {})
    assert.deepEqual(other.body.suggestions, [{ fact: 'Prefers tabs' }])
    assert.equal(seen[1].known.project, undefined)
    assert.equal((await call(`/jobs/${busy.id}/suggest`, {})).status, 400)
  } finally {
    server.close()
    jobs.stop(busy.id)
  }
  for (const [memory, withSuggest] of [[false, true], [undefined, false]] as const) {
    const off = await serve(memory, withSuggest)
    try {
      assert.equal((await off.call(`/jobs/${here.id}`)).body.suggests, undefined)
      assert.equal((await off.call(`/jobs/${here.id}/suggest`, {})).status, 400)
    } finally {
      off.server.close()
    }
  }
})
