import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { findBrowser } from '../src/browser.ts'
import { makeJobs } from '../src/jobs.ts'
import { makeSchedules } from '../src/schedules.ts'
import { listen, type ServeDeps } from '../src/serve.ts'
import { makeRecorder } from '../src/undo.ts'

// A real Chromium, headless; CI installs it. Elsewhere, without one, these are skipped.
const executable = await findBrowser()
const skip = !process.env.CI && !executable && 'no Chromium installed (navi browser --install)'

const noModels: ServeDeps = { route: async () => null, why: async () => 'none', fetch, forget: () => {}, log: () => {} }

test('SCH-12: the phone page makes a watch, lists it, runs it now and deletes it', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({
    home,
    start: async () => {
      throw new Error('no model here')
    },
    notify: () => {},
  })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const token = 'c'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], schedules } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('dialog', (d) => void d.accept())
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)

  await page.getByPlaceholder('What should navi do?').fill('check the status page')
  await page.getByLabel('When').selectOption('weekdays')
  await page.getByLabel('Time').fill('07:45')
  await page.getByLabel('Only tell me when something changes').check()
  await page.getByRole('button', { name: 'Schedule' }).click()

  await page.getByText('At 07:45 on weekdays · watch').waitFor()
  const [made] = schedules.list()
  assert.deepEqual({ at: made.at, days: made.days, quiet: made.quiet, prompt: made.prompt }, {
    at: '07:45',
    days: [1, 2, 3, 4, 5],
    quiet: true,
    prompt: 'check the status page',
  })
  // The box is back to a job now.
  assert.equal(await page.getByLabel('When').inputValue(), 'now')

  // Run now opens the job it started.
  await page.getByRole('button', { name: 'Run now' }).click()
  await page.getByRole('button', { name: '‹ Jobs' }).waitFor()
  assert.equal(jobs.list()[0].schedule, made.id)
  await page.getByRole('button', { name: '‹ Jobs' }).click()

  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByText('At 07:45 on weekdays · watch').waitFor({ state: 'detached' })
  assert.equal(schedules.list().length, 0)
  await jobs.idle()
})

test('SCH-13: the page holds still while a choice is open', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({ home, start: async () => Promise.reject(new Error('none')), notify: () => {} })
  const token = 'd'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home] } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  const when = page.getByLabel('When')
  await when.focus()
  // Marked, so a redraw (which makes a new element) would show.
  await when.evaluate((e) => e.setAttribute('data-mark', '1'))
  await page.waitForTimeout(3500)
  assert.equal(await page.locator('[data-mark]').count(), 1)
})

test('UND-13: a finished job shows what it changed, and Undo changes puts it back', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({ home, start: async () => Promise.reject(new Error('no model here')), notify: () => {} })
  const job = jobs.create('tidy the notes', home)
  await jobs.idle()
  await writeFile(join(home, 'notes.txt'), 'tidied')
  const r = makeRecorder(home, home, 'tidy the notes', undefined, job.id)
  r.wrote(join(home, 'notes.txt'), 'messy', 'tidied')
  await r.saved()
  const token = 'f'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('dialog', (d) => void d.accept())
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('tidy the notes').click()
  await page.getByText('Changed notes.txt').waitFor()
  await page.getByRole('button', { name: 'Undo changes' }).click()
  await page.getByText('put back notes.txt').waitFor()
  assert.equal(await readFile(join(home, 'notes.txt'), 'utf8'), 'messy')
  await page.getByRole('button', { name: 'Undo changes' }).waitFor({ state: 'detached' })
})

test('JOB-16: the phone sends picked files with a job, photos as JPEG', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const given: unknown[] = []
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: {
        history: [],
        async *turn(_p: string, o: any) {
          given.push(o?.attachments)
          yield { type: 'done', history: [], text: 'Seen.', empty: false, stopped: false } as const
        },
      },
    }),
    notify: () => {},
  })
  const token = '9'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
  await page.getByLabel('Add photo or file').setInputFiles([
    { name: 'receipt.png', mimeType: 'image/png', buffer: png },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('total 12.50') },
  ])
  await page.getByText('receipt.jpg').waitFor()
  await page.getByRole('button', { name: 'Remove notes.txt' }).click()
  await page.getByText('notes.txt').waitFor({ state: 'detached' })
  await page.getByPlaceholder('What should navi do?').fill('what is the total?')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByText('With receipt.jpg').waitFor()
  await jobs.idle()
  const [sent] = given as any[][]
  assert.equal(sent.length, 1)
  assert.equal(sent[0].name, 'receipt.jpg')
  assert.equal(sent[0].mediaType, 'image/jpeg')
  // Picked files are gone once sent.
  // JOB-20: a follow-up takes files of its own.
  await page.getByLabel('Add photo or file').setInputFiles([{ name: 'menu.txt', mimeType: 'text/plain', buffer: Buffer.from('soup 4') }])
  await page.getByText('menu.txt').waitFor()
  await page.getByPlaceholder('Follow up…').fill('and this one?')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByText('With receipt.jpg, menu.txt').waitFor()
  await jobs.idle()
  assert.equal(given.length, 2)
  assert.deepEqual((given[1] as any[]).map((a) => a.name), ['menu.txt'])
  assert.equal(await page.locator('.file').count(), 0)
  await page.getByRole('button', { name: '‹ Jobs' }).click()
  assert.equal(await page.getByText('receipt.jpg').count(), 0)
})

test('JOB-17, JOB-18: an answer shows formatted, and nothing in it runs', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const answer = '# Receipt\nThe latte was **$5.25**.\n\n- one\n- two\n\n<img src=x onerror="document.title=\'pwned\'"> [bad](javascript:document.title=1) [good](https://example.com)'
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: {
        history: [],
        async *turn() {
          yield { type: 'done', history: [], text: answer, empty: false, stopped: false } as const
        },
      },
    }),
    notify: () => {},
  })
  const job = jobs.create('read it', home)
  await jobs.idle()
  const token = '8'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('read it').click()
  const md = page.locator('.md')
  await md.locator('strong', { hasText: '$5.25' }).waitFor()
  assert.equal(await md.locator('li').count(), 2)
  assert.equal(await md.locator('img').count(), 0)
  assert.match(await md.innerText(), /<img src=x onerror=/)
  assert.deepEqual(await md.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')])), [
    ['good', 'https://example.com', 'noopener noreferrer'],
  ])
  await page.waitForTimeout(200)
  assert.notEqual(await page.title(), 'pwned')
  assert.equal(job.answer, answer)
})

test('JOB-23: a queued job shows as queued, and Stop takes it out', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({
    home,
    atOnce: 1,
    start: async () => ({
      model: 'small',
      session: {
        history: [],
        async *turn(_p: string, o: any) {
          await new Promise((r) => o.signal.addEventListener('abort', r, { once: true }))
          yield { type: 'done', history: [], text: '', empty: true, stopped: true } as const
        },
      },
    }),
    notify: () => {},
  })
  jobs.create('first, which runs', home)
  const queued = jobs.create('second, which waits its turn', home)
  const token = '8'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('second, which waits its turn').click()
  await page.locator('.s-queued').waitFor()
  await page.getByText('queued: next, as 1 run at once').waitFor()
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.locator('.s-stopped').waitFor()
  assert.equal(jobs.get(queued.id)!.status, 'stopped')
})

test('MEM-13: the phone shows what navi remembers, adds a fact and forgets one', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  await mkdir(join(home, '.neoai'), { recursive: true })
  await writeFile(join(home, '.neoai', 'memory.md'), '- Keeps bees\n')
  const jobs = await makeJobs({ home, start: async () => { throw new Error('unused') }, notify: () => {} })
  const token = '7'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('dialog', (d) => d.accept())
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByRole('button', { name: 'What navi remembers ›' }).click()
  await page.getByText('Keeps bees').waitFor()
  await page.getByText('These go with every turn').waitFor()
  await page.getByPlaceholder('Something navi should know about you').fill('Prefers metric units')
  await page.getByPlaceholder('Something navi should know about you').press('Enter')
  await page.locator('.fact', { hasText: 'Prefers metric units' }).waitFor()
  assert.equal(await page.getByPlaceholder('Something navi should know about you').inputValue(), '')
  await page.getByRole('button', { name: 'Forget Keeps bees' }).click()
  await page.locator('.fact', { hasText: 'Keeps bees' }).waitFor({ state: 'detached' })
  assert.equal(await readFile(join(home, '.neoai', 'memory.md'), 'utf8'), '- Prefers metric units\n')
  // A refused fact says why, and stays in the box to fix.
  await page.getByPlaceholder('Something navi should know about you').fill('prefers METRIC units')
  await page.getByRole('button', { name: 'Remember' }).click()
  await page.getByText('That is already remembered.').waitFor()
  await page.getByRole('button', { name: '‹ Jobs' }).click()
  await page.getByText('No jobs yet.').waitFor()
})

test('JOB-26: the phone deletes a finished job, and clears the rest', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: { history: [], async *turn() { yield { type: 'done', history: [], text: 'Done.', empty: false, stopped: false } as const } },
    }),
    notify: () => {},
  })
  for (const p of ['alpha job', 'beta job', 'gamma job']) jobs.create(p, home)
  await jobs.idle()
  const token = '6'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('dialog', (d) => d.accept())
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('beta job').click()
  await page.getByRole('button', { name: 'Delete job' }).click()
  await page.getByRole('button', { name: 'Clear finished jobs' }).waitFor()
  assert.equal(await page.getByText('beta job').count(), 0)
  assert.equal(jobs.list().length, 2)
  await page.getByRole('button', { name: 'Clear finished jobs' }).click()
  await page.getByText('No jobs yet.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Clear finished jobs' }).count(), 0)
})

test('JOB-28: a followed-up job folds its earlier turns away, and they stay open across refreshes', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  let history: any[] = []
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: {
        get history() { return history },
        async *turn(p: string) {
          history = [...history, { role: 'user', content: p }, { role: 'assistant', content: p === 'first' ? 'The **first** answer.' : 'The second answer.' }]
          yield { type: 'done', history, text: p === 'first' ? 'The **first** answer.' : 'The second answer.', empty: false, stopped: false } as const
        },
      },
    }),
    notify: () => {},
  })
  const job = jobs.create('first', home)
  await jobs.idle()
  jobs.reply(job.id, 'second')
  await jobs.idle()
  const token = '5'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.locator('.job').first().click()
  await page.getByText('Earlier in this job (1)').waitFor()
  await page.getByText('Then you asked').waitFor()
  assert.equal(await page.locator('.card.answer').innerText(), 'The second answer.')
  assert.equal(await page.locator('.earlier strong').isVisible(), false)
  await page.getByText('Earlier in this job (1)').click()
  assert.equal(await page.locator('.earlier strong').innerText(), 'first')
  // Through a refresh or two, still open.
  await page.waitForTimeout(3500)
  assert.equal(await page.locator('.earlier strong').isVisible(), true)
})

test('JOB-30: a search box narrows a long job list as you type', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const answers: Record<string, string> = { 'water the plants': 'Watered the ferns.', 'check the printer': 'Out of toner.', 'tidy downloads': 'Moved 12 files.', 'read the news': 'Nothing big.' }
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: { history: [], async *turn(prompt: string) { yield { type: 'done', history: [], text: answers[prompt], empty: false, stopped: false } as const } },
    }),
    notify: () => {},
  })
  for (const p of Object.keys(answers)) jobs.create(p, home)
  await jobs.idle()
  const token = '7'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], home } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('read the news').waitFor()
  const box = page.getByPlaceholder('Find a job')
  await box.pressSequentially('Toner')
  await page.getByText('water the plants').waitFor({ state: 'detached' })
  assert.equal(await page.locator('button.job').count(), 1)
  assert.equal(await page.locator('button.job .p').textContent(), 'check the printer')
  // Typing goes on in the box the page redrew.
  await box.pressSequentially(' fern')
  await page.getByText('No job mentions Toner fern.').waitFor()
  await box.fill('')
  await page.getByText('water the plants').waitFor()
  assert.equal(await page.locator('button.job').count(), 4)
})

test('SCH-18, SCH-21: the phone edits, pauses and resumes a schedule, and a refresh keeps what is typed', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({ home, start: async () => { throw new Error('no model here') }, notify: () => {} })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  const s = await schedules.add('check the status page', home, { at: '09:00', days: [1, 3] }, true)
  const token = 'e'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], schedules } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByRole('button', { name: 'Edit' }).click()
  // Other days are kept unless another choice is made; only the time changes.
  assert.equal(await page.locator('#edit-repeat').inputValue(), 'keep')
  await page.locator('#edit-time').fill('10:15')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('At 10:15 on Mon, Wed · watch').waitFor()
  assert.deepEqual({ at: schedules.get(s.id)?.at, days: schedules.get(s.id)?.days }, { at: '10:15', days: [1, 3] })

  await page.getByRole('button', { name: 'Edit' }).click()
  const box = page.getByLabel('Prompt')
  await box.fill('check the status page and the disks')
  // Past a refresh (every 3 seconds), the form and what was typed are still there.
  await page.waitForTimeout(3500)
  assert.equal(await box.inputValue(), 'check the status page and the disks')
  await page.locator('#edit-repeat').selectOption('60')
  await page.getByLabel('Only tell me when something changes').uncheck()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.locator('.sched .status', { hasText: 'Every hour' }).waitFor()
  assert.deepEqual({ every: schedules.get(s.id)?.every, quiet: schedules.get(s.id)?.quiet, prompt: schedules.get(s.id)?.prompt },
    { every: 60, quiet: undefined, prompt: 'check the status page and the disks' })

  // SCH-21: Pause shows it paused; Resume brings back its next run.
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByText('Paused · Every hour').waitFor()
  await page.getByText(/^Not running/).waitFor()
  assert.equal(schedules.get(s.id)?.paused, true)
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.locator('.sched .meta', { hasText: /^Next / }).waitFor()
  assert.equal(schedules.get(s.id)?.paused, undefined)

  // Cancel changes nothing.
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Prompt').fill('something else')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByText('check the status page and the disks').waitFor()
  assert.equal(schedules.get(s.id)?.prompt, 'check the status page and the disks')
})

test('JOB-34, SCH-24: Repeat this makes a schedule of a finished job, whose runs then show on its card', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({
    home,
    start: async () => ({
      model: 'small',
      session: { history: [], async *turn() { yield { type: 'done', history: [], text: 'Three new notes.', empty: false, stopped: false } as const } },
    }),
    notify: () => {},
  })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false })
  jobs.create('summarise the new notes', home)
  await jobs.idle()
  const token = 'f'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], schedules } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('summarise the new notes').click()
  await page.getByRole('button', { name: 'Repeat this…' }).click()
  // Cancel folds it away again.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Repeat this…' }).click()
  await page.getByLabel('Repeat', { exact: true }).selectOption('weekdays')
  await page.getByLabel('Repeat at').fill('06:45')
  await page.getByLabel('Only tell me when something changes').check()
  await page.getByRole('button', { name: 'Schedule' }).click()
  await page.getByText('At 06:45 on weekdays · watch').waitFor()
  const [made] = schedules.list()
  assert.deepEqual({ prompt: made.prompt, directory: made.directory, at: made.at, days: made.days, quiet: made.quiet },
    { prompt: 'summarise the new notes', directory: home, at: '06:45', days: [1, 2, 3, 4, 5], quiet: true })
  // A job a schedule started is not offered again.
  await page.getByRole('button', { name: 'Run now' }).click()
  await page.getByRole('button', { name: '‹ Jobs' }).waitFor()
  await page.getByRole('button', { name: 'Delete job' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Repeat this…' }).count(), 0)

  // SCH-24: back on the list, the run shows as a mark that opens its job.
  await page.getByRole('button', { name: '‹ Jobs' }).click()
  const mark = page.getByRole('button', { name: /^done, / })
  await mark.waitFor()
  assert.equal(await mark.textContent(), '✓')
  await mark.click()
  await page.getByRole('button', { name: 'Delete job' }).waitFor()
  assert.match(await page.locator('.meta').first().textContent() ?? '', /notes|navi-phone/)
})

test('SCH-27: a schedule navi paused for failing says so, and Resume starts it again', { skip }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'navi-phone-'))
  const jobs = await makeJobs({ home, start: async () => { throw new Error('no model here') }, notify: () => {} })
  const schedules = await makeSchedules({ home, start: (p, d, o) => jobs.create(p, d, o).id, answerOf: () => undefined, busy: () => false, statusOf: (id) => jobs.get(id)?.status })
  const s = await schedules.add('check the backups', home, { every: 60 })
  for (let i = 0; i < 3; i++) {
    await schedules.run(s.id)
    await jobs.idle()
    await schedules.tick()
  }
  const token = '9'.repeat(64)
  const [server] = await listen([], noModels, 0, { jobs: { jobs, token, directories: async () => [home], schedules } })
  const browser = await chromium.launch({ executablePath: executable ?? undefined })
  t.after(async () => {
    await browser.close()
    server.close()
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`)
  await page.getByText('Paused after 3 failed runs · Every hour').waitFor()
  assert.equal(await page.locator('button.run').count(), 3)
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.locator('.sched .status', { hasText: /^Every hour$/ }).waitFor()
  assert.equal(schedules.get(s.id)?.stuck, undefined)
})
