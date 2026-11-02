import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETRY_AFTER, checkWhen, makeSchedules, nextRun, nextText, parseDays, parseEvery, runMarks, schedulesFile, whenText, type ScheduleDeps } from '../src/schedules.ts'
import { makeJobs, type StartOptions } from '../src/jobs.ts'
import { fromWall, type Offset } from '../src/clock.ts'
import { listen, type ServeDeps } from '../src/serve.ts'

/** A fixed zone, UTC-8, so the tests read the same on any computer. */
const zone: Offset = () => -480
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo - 1, d, h, mi, zone)

async function setup(o: Partial<ScheduleDeps> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'navi-schedules-'))
  const started: { prompt: string; schedule: string }[] = []
  const sent: StartOptions[] = []
  const busy = new Set<string>()
  const answers = new Map<string, string>()
  const deps: ScheduleDeps = {
    home,
    start: (prompt, _dir, o) => {
      started.push({ prompt, schedule: o.schedule! })
      sent.push(o)
      return `job${started.length}`
    },
    answerOf: (id) => answers.get(id),
    busy: (id) => busy.has(id),
    ...o,
  }
  return { home, started, sent, busy, answers, deps, schedules: await makeSchedules(deps) }
}

test('SCH-1: a schedule is at a time of day or every 5 minutes or more, not both', () => {
  assert.equal(checkWhen({ at: '08:00' }), undefined)
  assert.equal(checkWhen({ at: '8:30', days: [1, 2] }), undefined)
  assert.equal(checkWhen({ every: 5 }), undefined)
  assert.match(checkWhen({ every: 4 }) ?? '', /5 at the least/)
  assert.match(checkWhen({ at: '25:00' }) ?? '', /HH:MM/)
  assert.match(checkWhen({ at: '08:00', every: 30 }) ?? '', /either/)
  assert.match(checkWhen({}) ?? '', /either/)
  assert.match(checkWhen({ at: '08:00', days: [7] }) ?? '', /0 \(Sunday\) to 6/)
  assert.match(checkWhen({ every: 30, days: [1] }) ?? '', /days go with at/)
})

test('SCH-2: the next run of an every and an at schedule', () => {
  assert.deepEqual(nextRun({ every: 30 }, at(2026, 11, 2, 9, 10), zone), at(2026, 11, 2, 9, 40))
  // Later today, or tomorrow once it has passed.
  assert.deepEqual(nextRun({ at: '08:00' }, at(2026, 11, 2, 7, 0), zone), at(2026, 11, 2, 8, 0))
  assert.deepEqual(nextRun({ at: '08:00' }, at(2026, 11, 2, 8, 0), zone), at(2026, 11, 3, 8, 0))
  // 2026-11-06 is a Friday: weekdays skip to Monday.
  assert.deepEqual(nextRun({ at: '08:00', days: [1, 2, 3, 4, 5] }, at(2026, 11, 6, 9, 0), zone), at(2026, 11, 9, 8, 0))
})

test('SCH-8: lengths and days as typed', () => {
  assert.equal(parseEvery('30m'), 30)
  assert.equal(parseEvery('2h'), 120)
  assert.equal(parseEvery('soon'), undefined)
  assert.deepEqual(parseDays('mon,wed'), [1, 3])
  assert.deepEqual(parseDays('weekdays'), [1, 2, 3, 4, 5])
  assert.deepEqual(parseDays('sat sun'), [0, 6])
  assert.equal(parseDays('someday'), undefined)
  assert.equal(whenText({ every: 120 }), 'every 2 h')
  assert.equal(whenText({ at: '08:00', days: [1, 3] }), 'at 08:00 on Mon, Wed')
  assert.equal(whenText({ at: '08:00', days: [1, 2, 3, 4, 5] }), 'at 08:00 on weekdays')
  const now = at(2026, 11, 2, 9, 0)
  assert.equal(nextText(at(2026, 11, 2, 9, 25), now, zone), 'in 25 min')
  assert.equal(nextText(at(2026, 11, 3, 8, 0), now, zone), 'tomorrow 08:00')
})

test('SCH-2: a due schedule starts a job carrying its id, and not again until the next run', async () => {
  const { schedules, started } = await setup()
  const s = await schedules.add('the morning brief', '/tmp', { every: 30 })
  const made = new Date(s.created)
  await schedules.tick(new Date(made.getTime() + 29 * 60_000))
  assert.equal(started.length, 0)
  const due = new Date(made.getTime() + 30 * 60_000)
  await schedules.tick(due)
  await schedules.tick(due)
  assert.deepEqual(started, [{ prompt: 'the morning brief', schedule: s.id }])
  assert.equal(schedules.get(s.id)?.job, 'job1')
  await schedules.tick(new Date(due.getTime() + 30 * 60_000))
  assert.equal(started.length, 2)
})

test('SCH-3: a schedule whose last job is still busy is skipped', async () => {
  const { schedules, started, busy } = await setup()
  const s = await schedules.add('watch the page', '/tmp', { every: 10 })
  const t0 = new Date(s.created).getTime()
  await schedules.tick(new Date(t0 + 10 * 60_000))
  busy.add('job1')
  await schedules.tick(new Date(t0 + 20 * 60_000))
  assert.equal(started.length, 1)
  busy.clear()
  await schedules.tick(new Date(t0 + 30 * 60_000))
  assert.equal(started.length, 2)
})

test('SCH-4: missed runs are made up once, and not at all past 12 hours', async () => {
  const { schedules, started } = await setup()
  const s = await schedules.add('every ten', '/tmp', { every: 10 })
  const t0 = new Date(s.created).getTime()
  // Down for two hours: one run, not twelve.
  await schedules.tick(new Date(t0 + 2 * 60 * 60_000))
  await schedules.tick(new Date(t0 + 2 * 60 * 60_000 + 1000))
  assert.equal(started.length, 1)
  const other = await setup()
  const late = await other.schedules.add('brief', '/tmp', { every: 60 })
  const t1 = new Date(late.created).getTime()
  // Due an hour in, looked at 14 hours in: skipped, and the next is an hour on.
  await other.schedules.tick(new Date(t1 + 14 * 60 * 60_000))
  assert.equal(other.started.length, 0)
  await other.schedules.tick(new Date(t1 + 15 * 60 * 60_000))
  assert.equal(other.started.length, 1)
})

test('SCH-5: schedules survive a restart, in a 0600 file', async () => {
  const { home, deps, schedules, started } = await setup()
  const s = await schedules.add('brief', '/tmp', { at: '08:00', days: [1] })
  await schedules.run(s.id)
  assert.equal((await stat(schedulesFile(home))).mode & 0o777, 0o600)
  const again = await makeSchedules(deps)
  assert.equal(again.get(s.id)?.at, '08:00')
  assert.equal(again.get(s.id)?.last, schedules.get(s.id)?.last)
  assert.equal(started.length, 1)
  assert.ok(await again.remove(s.id))
  assert.equal(JSON.parse(await readFile(schedulesFile(home), 'utf8')).length, 0)
})

const noModels: ServeDeps = { route: async () => null, why: async () => 'none', fetch, forget: () => {}, log: () => {} }

test('SCH-7: the schedules API needs the token, checks what it is given, and runs one now', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-schedules-api-'))
  const jobs = await makeJobs({
    home,
    start: async () => {
      throw new Error('no model')
    },
    notify: () => {},
  })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token: 'a'.repeat(64), directories: async () => [home], schedules } })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (path: string, body?: unknown, token = 'a'.repeat(64)) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  assert.equal((await call('/schedules', undefined, 'b'.repeat(64))).status, 401)
  assert.equal((await call('/schedules', { prompt: 'x', every: 1 })).status, 400)
  assert.equal((await call('/schedules', { prompt: 'x', at: '08:00', directory: '/no/such/place' })).status, 400)
  assert.equal((await call('/schedules', { prompt: 'x', at: '08:00', quiet: 'yes' })).status, 400)
  const made = await call('/schedules', { prompt: 'the brief', at: '08:00', days: [1, 2, 3, 4, 5] })
  assert.equal(made.status, 201)
  const s = await made.json()
  assert.equal(s.directory, home)
  assert.ok(s.next)
  assert.equal((await (await call('/schedules')).json()).schedules.length, 1)
  const ran = await call(`/schedules/${s.id}/run`, {})
  assert.equal(ran.status, 201)
  const job = await ran.json()
  assert.equal(job.schedule, s.id)
  assert.equal((await call('/schedules/nope/run', {})).status, 404)
  assert.equal((await call(`/schedules/${s.id}/delete`, {})).status, 200)
  assert.equal((await (await call('/schedules')).json()).schedules.length, 0)
  await jobs.idle()
})

test('SCH-9, SCH-11: a watch is told what its last run with news said, and the prompt stays the user\'s', async () => {
  const { schedules, sent, answers } = await setup()
  const s = await schedules.add('what is new on the status page?', '/tmp', { every: 60 }, true)
  await schedules.run(s.id)
  // The first has nothing to compare with.
  assert.deepEqual(sent[0], { schedule: s.id, watch: true })
  answers.set('job1', 'All systems normal.')
  await schedules.run(s.id)
  assert.equal(sent[1].watch, true)
  assert.match(sent[1].send!, /^what is new on the status page\?\n/)
  assert.match(sent[1].send!, /All systems normal\./)
  assert.match(sent[1].send!, /exactly NOTHING NEW/)
  // A run that found nothing leaves the comparison where it was.
  answers.set('job2', 'NOTHING NEW')
  await schedules.run(s.id)
  assert.match(sent[2].send!, /All systems normal\./)
  assert.equal(schedules.get(s.id)?.news, 'All systems normal.')
  // A schedule that is not a watch is sent its prompt as it is.
  const plain = await schedules.add('brief', '/tmp', { every: 60 })
  await schedules.run(plain.id)
  assert.deepEqual(sent[3], { schedule: plain.id })
})

test('SCH-15: an edit changes a schedule in place, counts a new when from the change, and a watch forgets', async () => {
  const { schedules, sent, answers } = await setup()
  const s = await schedules.add('status page?', '/tmp', { at: '08:00', days: [1, 2] }, true)
  await schedules.run(s.id)
  answers.set('job1', 'All normal.')
  const now = new Date()
  const edited = await schedules.edit(s.id, { when: { every: 30 } }, now)
  assert.equal(edited?.id, s.id)
  assert.deepEqual({ at: edited?.at, days: edited?.days, every: edited?.every, job: edited?.job }, { at: undefined, days: undefined, every: 30, job: 'job1' })
  // Half an hour after the edit, not at once.
  assert.equal(schedules.list(now)[0].next, new Date(now.getTime() + 30 * 60_000).toISOString())
  // The when alone keeps what the watch compares with.
  await schedules.run(s.id)
  assert.match(sent[1].send!, /All normal\./)
  answers.set('job2', 'Disk full.')
  // A new prompt: the last answer is for the old one, so the next run is a first again.
  await schedules.edit(s.id, { prompt: 'status page and disks?' })
  await schedules.run(s.id)
  assert.deepEqual(sent[2], { schedule: s.id, watch: true })
  answers.set('job3', 'Disk ok.')
  await schedules.run(s.id)
  assert.match(sent[3].send!, /Disk ok\./)
  // No longer a watch, and back: still nothing old to compare with.
  await schedules.edit(s.id, { quiet: false })
  assert.equal(schedules.get(s.id)?.quiet, undefined)
  await schedules.run(s.id)
  assert.deepEqual(sent[4], { schedule: s.id })
  await schedules.edit(s.id, { quiet: true, when: { at: '07:15' } })
  assert.deepEqual({ at: schedules.get(s.id)?.at, days: schedules.get(s.id)?.days }, { at: '07:15', days: undefined })
  assert.equal(await schedules.edit('nope', { quiet: true }), undefined)
})

test('SCH-16: the edit API changes only what it is given, and checks it', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-schedules-api-'))
  const jobs = await makeJobs({ home, start: async () => { throw new Error('no model') }, notify: () => {} })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token: 'a'.repeat(64), directories: async () => [home], schedules } })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const edit = (id: string, body: unknown) =>
    fetch(`${base}/schedules/${id}/edit`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const s = await schedules.add('the brief', home, { at: '08:00', days: [1, 2, 3, 4, 5] })
  const daysOnly = await edit(s.id, { days: [0, 6] })
  assert.equal(daysOnly.status, 200)
  const got = await daysOnly.json()
  assert.deepEqual({ at: got.at, days: got.days, prompt: got.prompt }, { at: '08:00', days: [0, 6], prompt: 'the brief' })
  assert.ok(got.next)
  assert.deepEqual((await (await edit(s.id, { days: null })).json()).days, undefined)
  const renamed = await (await edit(s.id, { prompt: '  the morning brief ', quiet: true })).json()
  assert.deepEqual({ prompt: renamed.prompt, quiet: renamed.quiet, at: renamed.at }, { prompt: 'the morning brief', quiet: true, at: '08:00' })
  assert.equal((await (await edit(s.id, { every: 120 })).json()).every, 120)
  assert.equal((await edit(s.id, { days: [1] })).status, 400)
  assert.equal((await edit(s.id, { every: 2 })).status, 400)
  assert.equal((await edit(s.id, { at: '08:00', every: 30 })).status, 400)
  assert.equal((await edit(s.id, { prompt: ' ' })).status, 400)
  assert.equal((await edit(s.id, { quiet: 'no' })).status, 400)
  assert.equal((await edit(s.id, {})).status, 400)
  assert.equal((await edit('nope', { quiet: true })).status, 404)
  assert.equal(schedules.get(s.id)?.every, 120)
})

test('SCH-19, SCH-20: a paused schedule is never due, survives a restart, and resumes from the resume', async (t) => {
  const { deps, schedules, started } = await setup()
  const s = await schedules.add('the morning brief', '/tmp', { every: 30 })
  const other = await schedules.add('later one', '/tmp', { every: 60 })
  const made = new Date(s.created)
  await schedules.pause(s.id, true)
  // Listed after the one that will run, though it would be sooner.
  assert.deepEqual(schedules.list(made).map((x) => x.id), [other.id, s.id])
  await schedules.tick(new Date(made.getTime() + 45 * 60_000))
  assert.deepEqual(started.map((x) => x.schedule), [])
  assert.equal((await makeSchedules(deps)).get(s.id)?.paused, true)
  // Run now still runs it.
  await schedules.run(s.id)
  assert.equal(started.length, 1)
  const back = new Date(made.getTime() + 5 * 60 * 60_000)
  await schedules.pause(s.id, false, back)
  assert.equal(schedules.get(s.id)?.paused, undefined)
  // Five hours missed are not made up: the next is half an hour after resuming.
  await schedules.tick(back)
  assert.equal(started.filter((x) => x.schedule === s.id).length, 1)
  assert.equal(schedules.list(back).find((x) => x.id === s.id)?.next, new Date(back.getTime() + 30 * 60_000).toISOString())
  assert.equal(await schedules.pause('nope', true), undefined)

  const home = await mkdtemp(join(tmpdir(), 'navi-schedules-api-'))
  const jobs = await makeJobs({ home, start: async () => { throw new Error('no model') }, notify: () => {} })
  const api = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token: 'a'.repeat(64), directories: async () => [home], schedules: api } })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: '{}' })
  const one = await api.add('brief', home, { at: '08:00' })
  const paused = await post(`/schedules/${one.id}/pause`)
  assert.equal(paused.status, 200)
  assert.equal((await paused.json()).paused, true)
  assert.equal((await (await post(`/schedules/${one.id}/resume`)).json()).paused, undefined)
  assert.equal((await post('/schedules/nope/pause')).status, 404)
  assert.equal((await post(`/schedules/${one.id}/stop`)).status, 404)
})

test('JOB-32: a finished job is made a schedule of its first prompt, where it ran', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-schedules-api-'))
  let release = () => {}
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: {
        history: [],
        async *turn(prompt: string) {
          if (prompt === 'hang') await new Promise<void>((r) => (release = r))
          yield { type: 'done', history: [], text: 'Done.', empty: false, stopped: false } as const
        },
      },
    }),
    notify: () => {},
  })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token: 'a'.repeat(64), directories: async () => [home], schedules } })
  const [bare] = await listen([], noModels, 0, { jobs: { jobs, token: 'a'.repeat(64), directories: async () => [home] } })
  t.after(() => {
    server.close()
    bare.close()
  })
  const post = (srv: typeof server, path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const done = jobs.create('summarise the notes', home)
  const busy = jobs.create('hang', home)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal((await post(server, `/jobs/${busy.id}/schedule`, { every: 60 })).status, 400)
  release()
  await jobs.idle()
  assert.equal((await post(server, `/jobs/${done.id}/schedule`, { every: 1 })).status, 400)
  assert.equal((await post(server, `/jobs/${done.id}/schedule`, { every: 60, quiet: 'yes' })).status, 400)
  assert.equal((await post(server, '/jobs/nope/schedule', { every: 60 })).status, 404)
  assert.equal((await post(bare, `/jobs/${done.id}/schedule`, { every: 60 })).status, 404)
  const made = await post(server, `/jobs/${done.id}/schedule`, { at: '07:00', days: [1, 2, 3, 4, 5], quiet: true })
  assert.equal(made.status, 201)
  const s = await made.json()
  assert.deepEqual({ prompt: s.prompt, directory: s.directory, at: s.at, days: s.days, quiet: s.quiet }, { prompt: 'summarise the notes', directory: home, at: '07:00', days: [1, 2, 3, 4, 5], quiet: true })
  assert.ok(s.next)
})

test('SCH-22, SCH-23: a schedule lists its last five runs, newest first, and shows them as marks, oldest first', async (t) => {
  assert.equal(runMarks([{ status: 'running' }, { status: 'done', unchanged: true }, { status: 'stopped' }, { status: 'interrupted' }, { status: 'failed' }, { status: 'done' }]), '✓✗✗■–…')
  assert.equal(runMarks([]), '')
  const home = await mkdtemp(join(tmpdir(), 'navi-schedules-api-'))
  let n = 0
  const jobs = await makeJobs({
    home,
    start: async () => {
      // Every third run fails.
      if (++n % 3 === 0) throw new Error('no model')
      return { model: 'small', session: { history: [], async *turn() { yield { type: 'done', history: [], text: 'Fine.', empty: false, stopped: false } as const } } }
    },
    notify: () => {},
  })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token: 'a'.repeat(64), directories: async () => [home], schedules } })
  t.after(() => server.close())
  const s = await schedules.add('brief', home, { every: 60 })
  const other = await schedules.add('other', home, { every: 60 })
  const ran: string[] = []
  for (let i = 0; i < 6; i++) {
    ran.push((await schedules.run(s.id))!)
    await jobs.idle()
    // Started a millisecond apart, so newest first is a fixed order.
    await new Promise((r) => setTimeout(r, 5))
  }
  jobs.create('not from a schedule', home)
  await jobs.idle()
  const got = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/schedules`, { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })).json()
  const runs = got.schedules.find((x: any) => x.id === s.id).runs
  assert.deepEqual(runs.map((r: any) => r.id), ran.slice(1).reverse())
  assert.deepEqual(Object.keys(runs[0]).sort(), ['created', 'id', 'status'])
  assert.equal(runMarks(runs), '✓✗✓✓✗')
  assert.deepEqual(got.schedules.find((x: any) => x.id === other.id).runs, [])
})

test('SCH-25, SCH-26: three failures in a row pause a schedule once, with one notification; done resets, stopped and gone do not count', async () => {
  const status = new Map<string, string>()
  const told: { title: string; text: string; job: string }[] = []
  const { schedules, started, busy } = await setup({
    statusOf: (id) => status.get(id) as any,
    notify: (title, text, job) => told.push({ title, text, job }),
  })
  const s = await schedules.add('check the backups', '/tmp', { every: 60 })
  const end = async (how: string | undefined) => {
    const job = (await schedules.run(s.id))!
    // Counted only once it has ended.
    busy.add(job)
    status.set(job, 'failed')
    await schedules.tick(new Date(0))
    assert.notEqual(schedules.get(s.id)?.counted, job)
    busy.delete(job)
    status.delete(job)
    if (how) status.set(job, how)
    await schedules.tick(new Date(0))
  }
  await end('failed')
  await end('failed')
  await end('done')
  assert.equal(schedules.get(s.id)?.failures, undefined)
  await end('failed')
  await end('stopped')
  await end('interrupted')
  await end(undefined)
  await end('failed')
  assert.equal(schedules.get(s.id)?.failures, 2)
  assert.equal(schedules.get(s.id)?.paused, undefined)
  await end('failed')
  assert.deepEqual({ paused: schedules.get(s.id)?.paused, stuck: schedules.get(s.id)?.stuck, failures: schedules.get(s.id)?.failures }, { paused: true, stuck: true, failures: 3 })
  assert.equal(told.length, 1)
  assert.equal(told[0].title, 'navi paused a schedule')
  assert.match(told[0].text, /check the backups: its last 3 runs failed/)
  assert.equal(told[0].job, `job${started.length}`)
  // Paused, nothing more starts, and no second notification.
  const ran = started.length
  await schedules.tick(new Date(Date.now() + 10 * 60 * 60_000))
  assert.equal(started.length, ran)
  assert.equal(told.length, 1)
  // Resuming clears it all.
  await schedules.pause(s.id, false)
  assert.deepEqual({ paused: schedules.get(s.id)?.paused, stuck: schedules.get(s.id)?.stuck, failures: schedules.get(s.id)?.failures }, { paused: undefined, stuck: undefined, failures: undefined })
})

test('SCH-26: an edit resumes a schedule navi paused, but not one the user paused', async () => {
  const status = new Map<string, string>()
  const { schedules } = await setup({ statusOf: (id) => status.get(id) as any, notify: () => {} })
  const s = await schedules.add('check the backups', '/tmp', { every: 60 })
  for (let i = 0; i < 3; i++) {
    status.set((await schedules.run(s.id))!, 'failed')
    await schedules.tick(new Date(0))
  }
  assert.equal(schedules.get(s.id)?.stuck, true)
  await schedules.edit(s.id, { prompt: 'check the backups on the other disk' })
  assert.deepEqual({ paused: schedules.get(s.id)?.paused, stuck: schedules.get(s.id)?.stuck, failures: schedules.get(s.id)?.failures }, { paused: undefined, stuck: undefined, failures: undefined })
  await schedules.pause(s.id, true)
  await schedules.edit(s.id, { prompt: 'again' })
  assert.equal(schedules.get(s.id)?.paused, true)
})

test('SCH-28: a due run that failed is tried once more 5 minutes on, without moving the next run; only its second try counts', async () => {
  const status = new Map<string, string>()
  const { schedules, started, sent } = await setup({ statusOf: (id) => status.get(id) as any, notify: () => {} })
  const s = await schedules.add('the brief', '/tmp', { every: 60 })
  const t0 = new Date(s.created).getTime()
  const at = (min: number) => new Date(t0 + min * 60_000)
  await schedules.tick(at(60))
  assert.equal(started.length, 1)
  status.set('job1', 'failed')
  await schedules.tick(at(61))
  assert.equal(schedules.get(s.id)?.failures, undefined, 'not counted yet')
  assert.equal(schedules.get(s.id)?.retryAt, new Date(at(61).getTime() + RETRY_AFTER).toISOString())
  assert.equal(schedules.list(at(61))[0].retryAt, schedules.get(s.id)?.retryAt)
  await schedules.tick(at(65))
  assert.equal(started.length, 1)
  await schedules.tick(at(66))
  assert.equal(started.length, 2)
  assert.equal(sent[1].retry, 'job1')
  // The next run is still an hour after the first.
  assert.equal(schedules.list(at(66))[0].next, at(120).toISOString())
  status.set('job2', 'failed')
  await schedules.tick(at(67))
  assert.equal(schedules.get(s.id)?.failures, 1)
  assert.equal(schedules.get(s.id)?.retryAt, undefined, 'a second try is not tried again')
  // The next run, done, resets the count.
  await schedules.tick(at(120))
  status.set('job3', 'done')
  await schedules.tick(at(121))
  assert.equal(schedules.get(s.id)?.failures, undefined)
  // A second try that is done counts as the run being done.
  await schedules.tick(at(180))
  status.set('job4', 'failed')
  await schedules.tick(at(181))
  await schedules.tick(at(186))
  status.set('job5', 'done')
  await schedules.tick(at(187))
  assert.equal(schedules.get(s.id)?.failures, undefined)
  assert.equal(started.length, 5)
})

test('SCH-28, SCH-29: no second try when the next run comes first, after Run now, or once paused', async () => {
  const status = new Map<string, string>()
  const { schedules, started } = await setup({ statusOf: (id) => status.get(id) as any, notify: () => {} })
  const often = await schedules.add('every five', '/tmp', { every: 5 })
  const t0 = new Date(often.created).getTime()
  await schedules.tick(new Date(t0 + 5 * 60_000))
  status.set('job1', 'failed')
  await schedules.tick(new Date(t0 + 6 * 60_000))
  assert.deepEqual({ failures: schedules.get(often.id)?.failures, retryAt: schedules.get(often.id)?.retryAt }, { failures: 1, retryAt: undefined })
  await schedules.remove(often.id)

  const s = await schedules.add('the brief', '/tmp', { every: 60 })
  const job = (await schedules.run(s.id))!
  status.set(job, 'failed')
  await schedules.tick(new Date())
  assert.deepEqual({ failures: schedules.get(s.id)?.failures, retryAt: schedules.get(s.id)?.retryAt }, { failures: 1, retryAt: undefined })

  const t1 = new Date(schedules.get(s.id)!.last!).getTime()
  await schedules.tick(new Date(t1 + 60 * 60_000))
  status.set(`job${started.length}`, 'failed')
  await schedules.tick(new Date(t1 + 61 * 60_000))
  assert.ok(schedules.get(s.id)?.retryAt)
  await schedules.pause(s.id, true)
  assert.equal(schedules.get(s.id)?.retryAt, undefined)
  await schedules.pause(s.id, false, new Date(t1 + 62 * 60_000))
  const before = started.length
  await schedules.tick(new Date(t1 + 70 * 60_000))
  assert.equal(started.length, before)
})
