/**
 * The browser eval: each task in tasks.ts given to a running `navi serve` as a
 * job, approvals answered yes, and the answer and what the sites recorded
 * checked. Writes eval/browser/RESULTS.md.
 *
 *   HOME=<home> navi serve --port 8495 &
 *   HOME=<home> npx tsx eval/browser/run.mts --port 8495 [--only form,frame] [--headless]
 */
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect, disconnect } from '../../src/browser.ts'
import { serveToken } from '../../src/jobs.ts'
import { startSites } from './sites.ts'
import { TASKS } from './tasks.ts'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? undefined : (process.argv[i + 1] ?? '')
}
const port = Number(arg('port') ?? 8484)
const only = arg('only')?.split(',')
const TIMEOUT_MS = Number(arg('timeout') ?? 6 * 60_000)
const home = homedir()

const token = await serveToken(home)
const api = async (path: string, body?: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const got = await res.json()
  if (!res.ok) throw new Error(`${path}: ${got.error?.message ?? res.status}`)
  return got
}

// A headless browser for serve to attach to, for homes whose window cannot load pages.
if (process.argv.includes('--headless')) await disconnect(home).then(() => connect({ home, headless: true }))

const { base, recorded, server } = await startSites()
const { directories } = await api('/jobs/directories')
const rows: string[] = []
let passed = 0
let model = 'the default model'

for (const task of TASKS.filter((t) => !only || only.includes(t.id))) {
  recorded.posts.length = 0
  recorded.orders = 0
  const started = Date.now()
  let job = await api('/jobs', { prompt: task.prompt(base), directory: directories[0] })
  const asked: string[] = []
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 2000))
    job = await api(`/jobs/${job.id}`)
    if (job.status === 'waiting' && job.pending) {
      asked.push(job.pending.command.split('\n')[0].slice(0, 60))
      await api(`/jobs/${job.id}/answer`, { yes: true }).catch(() => {})
    } else if (!['queued', 'running', 'waiting'].includes(job.status)) break
  }
  if (['queued', 'running', 'waiting'].includes(job.status)) await api(`/jobs/${job.id}/stop`, {}).catch(() => {})
  model = job.model ?? model
  const secs = Math.round((Date.now() - started) / 1000)
  const answer: string = job.answer ?? ''
  const browsed = (job.log as string[]).filter((l) => /\bbrowser|\bpage\b|click|type|goto|open/i.test(l)).length
  const why = job.status === 'done' ? task.check(answer, recorded) : `job ${job.status}${job.error ? `: ${job.error}` : ''}`
  if (!why) passed++
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 140)
  rows.push(`| ${task.id} | ${task.tests} | ${why ? '✗' : '✓'} | ${secs} s | ${job.log.length} (${browsed}) | ${asked.length} | ${cell(why ?? answer)} |`)
  console.log(`${why ? 'FAIL' : 'PASS'} ${task.id} ${secs}s ${why ?? ''}`)
  await api(`/jobs/${job.id}/delete`, {}).catch(() => {})
}
server.close()

const report = `# Browser eval

${passed} of ${rows.length} passed, ${new Date().toISOString().slice(0, 10)}, with ${model}.

Local practice sites (eval/browser/sites.ts), each task given as a job to \`navi serve\`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`
await writeFile(join(import.meta.dirname, 'RESULTS.md'), report)
console.log(`\n${passed}/${rows.length} passed`)
