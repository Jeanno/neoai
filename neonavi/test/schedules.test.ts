import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkWhen, makeSchedules, nextRun, nextText, parseDays, parseEvery, schedulesFile, whenText, type ScheduleDeps } from '../src/schedules.ts'
import { makeJobs, type StartOptions } from '../src/jobs.ts'
import { listen, type ServeDeps } from '../src/serve.ts'

/** A local time, so the tests read the same in any time zone. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

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
  assert.deepEqual(nextRun({ every: 30 }, at(2026, 11, 2, 9, 10)), at(2026, 11, 2, 9, 40))
  // Later today, or tomorrow once it has passed.
  assert.deepEqual(nextRun({ at: '08:00' }, at(2026, 11, 2, 7, 0)), at(2026, 11, 2, 8, 0))
  assert.deepEqual(nextRun({ at: '08:00' }, at(2026, 11, 2, 8, 0)), at(2026, 11, 3, 8, 0))
  // 2026-11-06 is a Friday: weekdays skip to Monday.
  assert.deepEqual(nextRun({ at: '08:00', days: [1, 2, 3, 4, 5] }, at(2026, 11, 6, 9, 0)), at(2026, 11, 9, 8, 0))
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
  assert.equal(nextText(at(2026, 11, 2, 9, 25), now), 'in 25 min')
  assert.equal(nextText(at(2026, 11, 3, 8, 0), now), 'tomorrow 08:00')
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
