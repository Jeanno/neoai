import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
