#!/usr/bin/env bun
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { commandFrom, promptFrom, startsFresh } from './args.ts'
import { modelFor, parseModelSpec, walkChain, type Chosen, type Failure } from './spec.ts'
import { colorDiff, makeApprover, makeLine } from './approve.ts'
import { makeSpinner } from './spinner.ts'
import { serveMcp, type Ask } from './mcp.ts'
import { DEFAULT_PORT, installAgent, listen, realServeDeps, uninstallAgent } from './serve.ts'
import { ago, clearAllSessions, clearSession, listSessions, addPrompt, loadPrompts, loadSession, saveSession, sessionFile } from './session.ts'
import { exchangesMarkdown, transcript } from './transcript.ts'
import { attachStdin, MAX_UPLOAD } from './attach.ts'
import { attach, createHarness, CUT_NOTE, DEFAULT_STEPS, type Attachment, type HarnessEvent } from './harness.ts'
import { readConfig, reset } from 'neorouter'
import { configuredBrowser, disconnect, findBrowser, installBrowser, makeTab, showBrowser } from './browser.ts'
import { CLI_NEXT_STEP, realDeps, runSetup } from './setup.ts'
import { describe, entryLabel, escalationFor, modelLabel } from './setup-core.ts'
import { readLedger, readUndone, recordUndone, stats } from './ledger.ts'
import { makeJobs, matches, serveToken, tailnetAddresses, titleOf, working, type JobDeps } from './jobs.ts'
import { push, pushConfig } from './push.ts'
import { addFact, forgetFact, memoryFile, projectRoot, readMemory } from './memory.ts'
import { listUndo, namer, redo, redoneLines, undo, undoneReport } from './undo.ts'
import { wall } from './clock.ts'
import { makeQuietNotify, parseQuiet } from './quiet.ts'
import { makeSchedules, nextText, parseDays, parseEvery, runMarks, whenText } from './schedules.ts'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

/** A tool call's input on one line, long strings such as a file's content cut short (CLI-10). */
function echo(input: unknown): string {
  return JSON.stringify(input, (_, v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}…` : v))
}
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const highlight = (s: string) => `\x1b[100;97m${s}\x1b[0m`

/** Pulls `--flag value` (or a bare `--flag`) out of argv, leaving the prompt. */
/** Every value of a repeatable flag, under any of its names (CLI-22). */
function takeAll(argv: string[], names: string[]) {
  const values: string[] = []
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (names.includes(argv[i]) && i + 1 < argv.length) values.push(argv[++i])
    else rest.push(argv[i])
  }
  return { values, rest }
}

function takeFlag(argv: string[], flag: string, hasValue: boolean) {
  const at = argv.indexOf(flag)
  if (at === -1) return { value: undefined, rest: argv }
  return {
    value: hasValue ? argv[at + 1] : '',
    rest: [...argv.slice(0, at), ...argv.slice(at + (hasValue ? 2 : 1))],
  }
}

/** `navi setup [--check]`: getting a first model working (setup.md). */
async function setup(argv: string[]) {
  const check = takeFlag(argv, '--check', false)
  if (check.rest.length) {
    console.error(`unexpected: ${check.rest.join(' ')}`)
    console.error('usage: navi setup [--check]')
    return 1
  }
  // Setup reports the backend itself; the router's own line would say it twice.
  process.env.NEOROUTER_QUIET = '1'
  const line = makeLine({ input: process.stdin, output: process.stdout })
  try {
    const deps = realDeps({
      ask: (q) => line.ask(q),
      askSecret: (q) => line.ask(q, { secret: true }),
      print: (s) => console.log(s),
    })
    // Nobody at a pipe to answer the questions, so only report (SET-3).
    return await runSetup(deps, { check: check.value !== undefined || process.stdin.isTTY !== true })
  } finally {
    line.close()
  }
}

/** Typed at the prompt to leave; ^C and ^D work too. */
const QUIT = new Set(['exit', 'quit', 'q'])

// CLI-21
const HELP = [
  '/model             the model answering, and the saved chain',
  '/model <spec>      switch for this session: <provider>:<model>, local, best, or a list',
  '/attach <file>     send an image, PDF or text file with the next prompt',
  "/undo              put back the files navi's last turn changed",
  '/redo              bring back what the last /undo put back',
  '/help              this list',
  '^C                 stop an answer; at an empty prompt, leave',
  'exit, quit, ^D     leave',
].join('\n')

const USAGE = [
  'usage: navi [-p "what you want done"] [-a file]... [-r|--resume] [--model local|best|<provider>:<model>[,...]] [--max-steps N]',
  '       navi setup [--check]',
  '       navi sessions [show [<directory>] | clear [<directory> | --all]]',
  '       navi serve [--port N] [--install | --uninstall]',
  '       navi mcp',
  '       navi browser [--install]',
  '       navi stats [--days N]',
  '       navi job "<what you want done>" [-a <file>]… [-C <directory>]',
  '       navi jobs [<id> [y | n | stop | undo | delete | show | repeat (--at HH:MM [--days …] | --every 30m) [--only-changes] | reply "<follow-up>" [-a <file>]…] | find <words> | clear | link]',
  '       navi schedule "<what you want done>" (--at HH:MM [--days mon,tue,…] | --every 30m|2h) [--only-changes] [-C <directory>]',
  '       navi schedules [<id> run | pause | resume | rm | edit [--prompt …] [--at …] [--days …] [--every …] [--only-changes | --every-run]]',
  '       navi push test',
  '       navi memory [add [--project] "<fact>" | forget <n | words>]',
  '       navi undo [--list] [-C <directory>]',
  '       navi redo [-C <directory>]',
].join('\n')

/** What each form does, for --help (CLI-24). */
const ABOUT = [
  'navi                 a new conversation in this directory',
  'navi -p "…"          ask, continuing this directory\'s conversation; on a pipe,',
  '                     answer and exit with only the answer on stdout',
  '  -a, --attach FILE  send an image, PDF or text file with the prompt; - sends what is piped in',
  '  -r, --resume       bare navi continues the saved conversation too',
  '  --model SPEC       use another model chain for this run',
  '  --max-steps N      model responses per turn (default 32)',
  'navi setup           choose models and keys; --check only reports',
  'navi sessions        list saved conversations; show one as Markdown; clear one or --all',
  'navi serve           an OpenAI-compatible server on 127.0.0.1 for other apps, and jobs;',
  '                     --tailnet lets your phone reach it over Tailscale',
  'navi mcp             navi as a tool for MCP clients such as Claude Code',
  "navi browser         open navi's browser to sign in to sites; --install gets Chromium for it",
  'navi stats           how each model has done, from the ledger; --days N (default 30)',
  'navi job "…"         hand navi serve a job to do in the background; -a sends a file, -C sets where',
  'navi jobs            list jobs; <id> shows one, then y, n, stop, undo, delete, show (every turn), repeat (on a schedule) or reply; find lists those mentioning words; clear deletes finished ones; link is for a phone',
  'navi schedule "…"    have navi serve start a job at a time of day or every so often;',
  '                     --only-changes makes it a watch that only speaks when something changed',
  'navi schedules       list schedules and their next run; <id> run starts one now, pause, resume, edit changes it, rm deletes it',
  'navi push test       send a test push to your phone (set "push" in the config first)',
  'navi memory          what navi remembers about you and this project; add a fact, or forget one',
  "navi undo            put back the files navi's last turn here changed; --list shows what can be",
  'navi redo            bring back what the last undo here put back, unless changed since',
].join('\n')

/** Each link that did not answer, and why (MOD-21). */
function failedLines(failures: Failure[]): string[] {
  return failures.map((f) => `${['primary', 'fallback'][f.index] ?? `link ${f.index + 1}`} (${entryLabel(f.entry)}): ${f.why}`)
}

/** `navi mcp`: navi as an MCP server over stdio (mcp.md). */
async function mcp(argv: string[]) {
  if (argv.length) {
    console.error(`unexpected: ${argv.join(' ')}`)
    console.error('usage: navi mcp')
    return 1
  }
  process.env.NEOROUTER_QUIET = '1'
  const ask: Ask = async ({ prompt, directory, attachments }) => {
    const config = await readConfig()
    const { chosen, failures } = await walkChain(parseModelSpec(config.model, Object.keys(config.custom ?? {})))
    if (!chosen) throw new Error(`navi has no model to answer with: ${failedLines(failures).join('; ')}`)
    // No approve callback: what would need a y is declined (MCP-4).
    const harness = await createHarness({
      model: modelFor(chosen, config),
      contextWindow: chosen.contextWindow,
      cwd: directory,
      config,
      front: 'mcp',
      name: { model: modelLabel(chosen), local: chosen.local },
      escalate: escalationFor(config),
    })
    let done: Extract<HarnessEvent, { type: 'done' }> | undefined
    const errors: string[] = []
    for await (const e of harness.session().turn(prompt, { attachments })) {
      if (e.type === 'done') done = e
      else if (e.type === 'error') errors.push(e.error instanceof Error ? e.error.message : String(e.error))
    }
    if (!done || done.empty) throw new Error(errors[0] ?? 'the model returned no answer')
    return { text: done.text, model: modelLabel(chosen) }
  }
  await serveMcp(ask, { input: process.stdin, output: process.stdout })
  // A pipe's writes are asynchronous: exiting now could cut off the last replies.
  await new Promise<void>((r) => process.stdout.write('', () => r()))
  return 0
}

/** `navi serve [--port N]`: the chain as an OpenAI-compatible server (serve.md). */
async function serve(argv: string[]) {
  const tailnet = takeFlag(argv, '--tailnet', false)
  const install = takeFlag(tailnet.rest, '--install', false)
  const uninstall = takeFlag(install.rest, '--uninstall', false)
  const port = takeFlag(uninstall.rest, '--port', true)
  const n = port.value === undefined ? DEFAULT_PORT : Number(port.value)
  if (port.rest.length || !Number.isInteger(n) || n < 1 || n > 65535 || (install.value !== undefined && uninstall.value !== undefined)) {
    if (port.rest.length) console.error(`unexpected: ${port.rest.join(' ')}`)
    else if (!Number.isInteger(n) || n < 1 || n > 65535) console.error(`not a port: ${port.value}`)
    console.error('usage: navi serve [--port N] [--tailnet] [--install | --uninstall]')
    return 1
  }
  // SRV-8: kept running by launchd instead of this terminal.
  if (uninstall.value !== undefined) {
    console.log((await uninstallAgent(homedir())) ? 'Stopped navi serve and removed it from login.' : 'navi serve was not set to run at login.')
    return 0
  }
  if (install.value !== undefined) {
    const got = await installAgent(homedir(), n, tailnet.value !== undefined)
    if ('problem' in got) {
      console.error(got.problem)
      return 1
    }
    console.log(`navi serve now runs in the background and at every login, on ${bold(`http://127.0.0.1:${n}/v1`)}.`)
    console.log(dim(`Log: ${got.log} · stop it with \`navi serve --uninstall\``))
    // Started by launchd, it gets none of this shell's exports.
    if (got.unsaved.length)
      console.error(`${got.unsaved.join(', ')} ${got.unsaved.length > 1 ? 'are' : 'is'} set in this shell but not saved; navi serve will not see ${got.unsaved.length > 1 ? 'them' : 'it'}. Save keys with \`navi setup\`.`)
    return 0
  }
  // Each request is logged on its own line (SRV-6); the router's line would interleave.
  process.env.NEOROUTER_QUIET = '1'
  const config = await readConfig()
  const custom = Object.keys(config.custom ?? {})
  const chain = parseModelSpec(config.model, custom)
  const { chosen, failures } = await walkChain(chain)
  if (chosen) console.error(describe({ ...chosen, label: modelLabel(chosen) }))
  else console.error(`No model answers yet; requests will get a 503 until one does.`)
  for (const line of failedLines(failures)) console.error(dim(`· ${line}`))
  const home = homedir()
  const tailnetAt = tailnet.value === undefined ? [] : tailnetAddresses()
  // This computer's time, which Node's own zones can have wrong (SCH-14).
  const say = (line: string) => console.error(dim(`${wall(new Date()).toISOString().slice(11, 19)} ${line}`))
  // PSH-11: held in quiet hours, read from the config each time.
  const quiet = makeQuietNotify(makeNotify(tailnetAt[0] && `http://${tailnetAt[0]}:${n}/`, say), async () => parseQuiet((await readConfig()).quietHours), say)
  const { notify } = quiet
  const jobs = await makeJobs({ home, start: startJob, notify, atOnce: config.jobsAtOnce })
  const schedules = await makeSchedules({
    home,
    start: (prompt, directory, o) => jobs.create(prompt, directory, o).id,
    answerOf: (id) => (jobs.get(id)?.status === 'done' ? jobs.get(id)?.answer : undefined),
    busy: (id) => working(jobs.get(id)?.status),
    statusOf: (id) => jobs.get(id)?.status,
    notify,
  })
  if (tailnet.value !== undefined && !tailnetAt.length) console.error('This computer has no Tailscale address, so only it can reach navi serve.')
  const directories = async () => [...new Set([...(await listSessions(home)).flatMap((s) => (s.cwd ? [s.cwd] : [])), home])]
  try {
    await listen(chain, realServeDeps(say), n, {
      jobs: { jobs, token: await serveToken(home), directories, schedules, memory: config.memory !== false },
      tailnet: tailnetAt,
    })
  } catch (e) {
    const busy = (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
    console.error(busy ? `Port ${n} is in use; choose another with --port.` : `navi serve: ${(e as Error).message}`)
    return 1
  }
  console.error(`\nServing on ${bold(`http://127.0.0.1:${n}/v1`)}: give apps that base URL, any API key, and the model ${bold('navi')}.`)
  if (tailnetAt.length) console.error(dim(`Your tailnet reaches it too, with the token; \`navi jobs link\` gives a phone its link. ^C stops it.`))
  else console.error(dim('Only this computer can reach it. ^C stops it.'))
  // SCH-6: due schedules start within half a minute, and at once on starting (SCH-4).
  void schedules.tick()
  setInterval(() => void schedules.tick(), 30_000)
  // PSH-12: what was held goes once quiet hours are over.
  setInterval(() => void quiet.flush(), 30_000)
  if (config.quietHours !== undefined) {
    const q = parseQuiet(config.quietHours)
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    console.error(dim(q ? `Quiet hours ${hhmm(q.from)}–${hhmm(q.to)}: notifications then are held and sent as one after.` : `quietHours ${JSON.stringify(config.quietHours)} is not like "22:00-07:00", so it is ignored.`))
  }
  // Runs until stopped: the open server keeps the process alive.
  return new Promise<number>(() => {})
}

/** A job's session (JOB-1): the chain, escalation, the browser and the ledger, as the CLI's. */
async function startJob({ job, directory, history, approve, answered }: Parameters<JobDeps['start']>[0]) {
  const config = await readConfig()
  const { chosen, failures } = await walkChain(parseModelSpec(config.model, Object.keys(config.custom ?? {})))
  if (!chosen) throw new Error(`navi has no model to answer with: ${failedLines(failures).join('; ')}`)
  const harness = await createHarness({
    model: modelFor(chosen, config),
    contextWindow: chosen.contextWindow,
    cwd: directory,
    config,
    front: 'job',
    job,
    name: { model: modelLabel(chosen), local: chosen.local },
    escalate: escalationFor(config),
    browser: () => makeTab({ home: homedir() }),
    // Nothing is remembered from a job (JOB-4): its "yes" is only a yes.
    approve: async (command, o) => ((await approve(command, o)) === true),
  })
  return { session: harness.session(history, { answered }), model: modelLabel(chosen) }
}

/**
 * A job's notifications: on macOS unless the config turns them off (JOB-5),
 * and to a phone when `push` is set (PSH-1), opening the job on the phone page
 * at `page` when there is one (PSH-3). The config is read each time, so a
 * change needs no restart.
 */
function makeNotify(page: string | undefined, log: (line: string) => void): JobDeps['notify'] {
  return (title, text, job, urgent, key) =>
    void readConfig().then(async (config) => {
      if (process.platform === 'darwin' && config.notify !== false) {
        const quote = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`
        execFile('osascript', ['-e', `display notification ${quote(text)} with title ${quote(title)}`], () => {})
      }
      const p = pushConfig(config)
      if (!p) return
      const failed = await push(p, {
        title, job, detail: text, urgent,
        ...(page && { click: `${page}#job=${job}`, ...(key && { answer: `${page}answer/${job}/${key}` }) }),
      })
      // PSH-4: said, never the topic.
      if (failed) log(`push for job ${job} failed: ${failed}`)
    })
}

/** Talks to navi serve's jobs on this computer (JOB-13). */
async function jobsApi(port: number, path: string, body?: unknown): Promise<{ status: number; data: any } | null> {
  const token = await serveToken(homedir())
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  } catch {
    return null
  }
}

const NOT_SERVING = 'navi serve is not running. Start it with `navi serve`, or keep it running with `navi serve --install`.'

const statusWord = (s: string, unchanged?: boolean) => (s === 'waiting' ? bold('waiting for you') : unchanged ? 'nothing new' : s)

/** One job as `navi jobs <id>` shows it (JOB-13). */
function showJob(job: any) {
  console.log(`${bold(job.id)} · ${statusWord(job.status, job.unchanged)}${job.model ? ` · ${job.model}` : ''}`)
  console.log(dim(`${job.directory}${job.schedule ? ` · from schedule ${job.schedule}` : ''}${job.files?.length ? ` · with ${job.files.join(', ')}` : ''}`))
  console.log(job.prompt)
  if (job.log?.length) console.log(dim(job.log.join('\n')))
  if (job.pending) {
    console.log(`\n${bold('do?')} ${job.pending.command}${job.pending.url ? `\n${dim(job.pending.url)}` : ''}`)
    if (job.pending.diff) console.log(colorDiff(job.pending.diff))
    console.log(dim(`answer with \`navi jobs ${job.id} y\` or \`n\``))
  }
  if (job.answer) console.log(`\n${job.answer}`)
  if (job.error) console.error(`error: ${job.error}`)
  if (job.changes?.length) console.log(dim(`\nchanged ${job.changes.join(', ')}; \`navi jobs ${job.id} undo\` puts them back`))
  if (job.turns?.length > 1) console.log(dim(`earlier in this job: \`navi jobs ${job.id} show\``))
  if (!working(job.status)) console.log(dim(`follow up with \`navi jobs ${job.id} reply "<what next>"\` (-a <file> to add one)`))
}

/** Takes every `-a <file>` (or `--attach`) out of the arguments (JOB-16, JOB-20). */
function takeAttached(argv: string[]): { paths: string[]; rest: string[] } {
  let rest = argv
  const paths: string[] = []
  for (;;) {
    const a = takeFlag(rest, rest.includes('-a') ? '-a' : '--attach', true)
    if (a.value === undefined) break
    paths.push(a.value)
    rest = a.rest
  }
  return { paths, rest }
}

/** Files read here and sent whole: navi serve reads them as -a would (JOB-14); what is wrong, or them. */
async function readUploads(paths: string[]): Promise<{ name: string; data: string }[] | string> {
  const files: { name: string; data: string }[] = []
  for (const p of paths) {
    const size = (await stat(p).catch(() => null))?.size
    if (size === undefined) return `can't attach ${p}: no such file`
    if (size > MAX_UPLOAD) return `can't attach ${p}: a job takes up to ${MAX_UPLOAD / 1024 / 1024} MB of files`
    files.push({ name: basename(p), data: (await readFile(p)).toString('base64') })
  }
  return files
}

/** `navi job "<prompt>" [-a <file>]… [-C <directory>] [--port N]` (JOB-13, JOB-16). */
async function startJobCommand(argv: string[]) {
  const port = takeFlag(argv, '--port', true)
  const dir = takeFlag(port.rest, '-C', true)
  const { paths, rest } = takeAttached(dir.rest)
  const prompt = rest.join(' ').trim()
  const n = port.value === undefined ? DEFAULT_PORT : Number(port.value)
  if (!prompt || !Number.isInteger(n) || paths.some((p) => !p)) {
    console.error('usage: navi job "<what you want done>" [-a <file>]… [-C <directory>] [--port N]')
    return 1
  }
  const files = await readUploads(paths)
  if (typeof files === 'string') return console.error(files), 1
  const got = await jobsApi(n, '/jobs', { prompt, directory: resolve(dir.value ?? process.cwd()), ...(files.length && { files }) })
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status !== 201) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  console.log(`Started job ${bold(got.data.id)}. Follow it with \`navi jobs ${got.data.id}\`.`)
  return 0
}

/** `navi jobs <id> reply "<follow-up>" [-a <file>]…` (JOB-3, JOB-20). */
async function replyJobCommand(n: number, id: string, argv: string[]) {
  const { paths, rest } = takeAttached(argv)
  const prompt = rest.join(' ').trim()
  if (!prompt || paths.some((p) => !p)) return console.error(JOBS_USAGE), 1
  const files = await readUploads(paths)
  if (typeof files === 'string') return console.error(files), 1
  const got = await jobsApi(n, `/jobs/${id}/reply`, { prompt, ...(files.length && { files }) })
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  console.log(`Followed up job ${bold(id)}. Follow it with \`navi jobs ${id}\`.`)
  return 0
}

const JOBS_USAGE = 'usage: navi jobs [<id> [y | n | stop | undo | delete | show | repeat (--at HH:MM [--days …] | --every 30m) [--only-changes] | reply "<follow-up>" [-a <file>]…] | find <words> | clear | link] [--port N]'

/** `navi jobs [<id> [y | n | stop | undo | delete | reply …] | clear | link] [--port N]` (JOB-12, JOB-13, JOB-20, JOB-26). */
async function jobsCommand(argv: string[]) {
  const port = takeFlag(argv, '--port', true)
  const n = port.value === undefined ? DEFAULT_PORT : Number(port.value)
  const [id, what, ...extra] = port.rest
  if (what === 'reply' && Number.isInteger(n)) return replyJobCommand(n, id, extra)
  if (what === 'repeat' && Number.isInteger(n)) return repeatJobCommand(n, id, extra)
  if (id === 'find' && Number.isInteger(n)) {
    // JOB-31
    const words = [what, ...extra].filter(Boolean).join(' ')
    if (!words.trim()) return console.error(JOBS_USAGE), 1
    const got = await jobsApi(n, '/jobs')
    if (!got) return console.error(NOT_SERVING), 1
    const found = (got.data.jobs ?? []).filter((j: any) => matches(j, words))
    if (!found.length) return console.error(`No job mentions ${words}.`), 1
    for (const j of found) console.log(`${bold(j.id)}  ${statusWord(j.status, j.unchanged).padEnd(10)}  ${ago(new Date(j.created)).padEnd(10)}  ${titleOf(j.prompt)}`)
    return 0
  }
  if (extra.length || !Number.isInteger(n) || (what !== undefined && !['y', 'n', 'stop', 'undo', 'delete', 'show'].includes(what))) {
    console.error(JOBS_USAGE)
    return 1
  }
  if (id === 'link') {
    const at = tailnetAddresses()
    if (!at.length) return console.error('This computer has no Tailscale address; a phone reaches navi serve over Tailscale.'), 1
    const token = await serveToken(homedir())
    for (const a of at) console.log(`http://${a}:${n}/#${token}`)
    console.error(dim('This link is a key to this computer: anyone with it on your tailnet can run jobs. Run navi serve with --tailnet for it to answer.'))
    return 0
  }
  if (!id) {
    const got = await jobsApi(n, '/jobs')
    if (!got) return console.error(NOT_SERVING), 1
    const list = got.data.jobs ?? []
    if (!list.length) console.log('No jobs yet. Start one with `navi job "<what you want done>"`.')
    for (const j of list) console.log(`${bold(j.id)}  ${statusWord(j.status, j.unchanged).padEnd(10)}  ${ago(new Date(j.created)).padEnd(10)}  ${titleOf(j.prompt)}`)
    return 0
  }
  if (id === 'clear' && what === undefined) {
    // JOB-26
    const got = await jobsApi(n, '/jobs/clear', {})
    if (!got) return console.error(NOT_SERVING), 1
    if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
    const k = got.data.cleared as number
    console.log(k ? `Deleted ${k} finished job${k === 1 ? '' : 's'}; any still working are kept.` : 'No finished jobs to delete.')
    return 0
  }
  if (what === 'show') {
    // JOB-29: every turn, as Markdown, to read or keep.
    const got = await jobsApi(n, `/jobs/${id}`)
    if (!got) return console.error(NOT_SERVING), 1
    if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
    const turns = got.data.turns?.length ? got.data.turns : [{ prompt: got.data.prompt, ...(got.data.answer && { answer: got.data.answer }) }]
    process.stdout.write(exchangesMarkdown(turns, `navi job ${id} in ${got.data.directory}`))
    return 0
  }
  if (what === 'delete') {
    // JOB-26
    const got = await jobsApi(n, `/jobs/${id}/delete`, {})
    if (!got) return console.error(NOT_SERVING), 1
    if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
    console.log(`Deleted job ${bold(id)}.`)
    return 0
  }
  if (what === 'undo') {
    // UND-13
    const got = await jobsApi(n, `/jobs/${id}/undo`, {})
    if (!got) return console.error(NOT_SERVING), 1
    if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
    for (const l of got.data.lines as string[]) console.log(l.startsWith('not undone') ? dim(l) : l)
    return 0
  }
  const path = what === undefined ? `/jobs/${id}` : what === 'stop' ? `/jobs/${id}/stop` : `/jobs/${id}/answer`
  const got = await jobsApi(n, path, what === undefined ? undefined : what === 'stop' ? {} : { yes: what === 'y' })
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  showJob(got.data)
  return 0
}

/** `navi jobs <id> repeat (--at HH:MM [--days …] | --every N) [--only-changes]` (JOB-33). */
async function repeatJobCommand(n: number, id: string, argv: string[]) {
  const at = takeFlag(argv, '--at', true)
  const days = takeFlag(at.rest, '--days', true)
  const every = takeFlag(days.rest, '--every', true)
  const quiet = takeFlag(every.rest, '--only-changes', false)
  if (quiet.rest.length || (at.value === undefined) === (every.value === undefined)) return console.error(JOBS_USAGE), 1
  const minutes = every.value === undefined ? undefined : parseEvery(every.value)
  const on = days.value === undefined ? undefined : parseDays(days.value)
  if (every.value !== undefined && minutes === undefined) return console.error(`not a length of time: ${every.value} (say 30m or 2h)`), 1
  if (days.value !== undefined && !on) return console.error(`not days: ${days.value} (say mon,wed, weekdays or weekends)`), 1
  const got = await jobsApi(n, `/jobs/${id}/schedule`, { at: at.value, days: on, every: minutes, quiet: quiet.value !== undefined })
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status !== 201) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  console.log(`Scheduled ${bold(got.data.id)}: ${whenText(got.data)}${got.data.quiet ? ', only when something changed' : ''}, next ${nextText(new Date(got.data.next))}.`)
  console.log(dim(titleOf(got.data.prompt)))
  return 0
}

/** `navi schedule "<prompt>" (--at HH:MM [--days …] | --every N) [-C <dir>] [--port N]` (SCH-8). */
async function scheduleCommand(argv: string[]) {
  const port = takeFlag(argv, '--port', true)
  const dir = takeFlag(port.rest, '-C', true)
  const at = takeFlag(dir.rest, '--at', true)
  const days = takeFlag(at.rest, '--days', true)
  const every = takeFlag(days.rest, '--every', true)
  const quiet = takeFlag(every.rest, '--only-changes', false)
  const prompt = quiet.rest.join(' ').trim()
  const n = port.value === undefined ? DEFAULT_PORT : Number(port.value)
  const minutes = every.value === undefined ? undefined : parseEvery(every.value)
  const on = days.value === undefined ? undefined : parseDays(days.value)
  const usage = 'usage: navi schedule "<what you want done>" (--at HH:MM [--days mon,tue,…] | --every 30m|2h) [--only-changes] [-C <directory>] [--port N]'
  if (!prompt || !Number.isInteger(n) || (at.value === undefined) === (every.value === undefined)) return console.error(usage), 1
  if (every.value !== undefined && minutes === undefined) return console.error(`not a length of time: ${every.value} (say 30m or 2h)`), 1
  if (days.value !== undefined && !on) return console.error(`not days: ${days.value} (say mon,wed, weekdays or weekends)`), 1
  const got = await jobsApi(n, '/schedules', { prompt, directory: resolve(dir.value ?? process.cwd()), at: at.value, days: on, every: minutes, quiet: quiet.value !== undefined })
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status !== 201) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  console.log(`Scheduled ${bold(got.data.id)}: ${whenText(got.data)}${got.data.quiet ? ', only when something changed' : ''}, next ${nextText(new Date(got.data.next))}.`)
  console.log(dim(`navi serve starts it as a job; \`navi schedules ${got.data.id} rm\` deletes it.`))
  return 0
}

const SCHEDULES_USAGE =
  'usage: navi schedules [<id> run | pause | resume | rm | edit [--prompt "<prompt>"] [--at HH:MM] [--days mon,tue,…|all] [--every 30m|2h] [--only-changes | --every-run]] [--port N]'

/** `navi schedules <id> edit …` (SCH-17): only what is given changes. */
async function editScheduleCommand(n: number, id: string, argv: string[]) {
  const prompt = takeFlag(argv, '--prompt', true)
  const at = takeFlag(prompt.rest, '--at', true)
  const days = takeFlag(at.rest, '--days', true)
  const every = takeFlag(days.rest, '--every', true)
  const watch = takeFlag(every.rest, '--only-changes', false)
  const always = takeFlag(watch.rest, '--every-run', false)
  const given = [prompt, at, days, every, watch, always].some((f) => f.value !== undefined)
  if (always.rest.length || !given || (at.value !== undefined && every.value !== undefined) || (watch.value !== undefined && always.value !== undefined))
    return console.error(SCHEDULES_USAGE), 1
  const minutes = every.value === undefined ? undefined : parseEvery(every.value)
  if (every.value !== undefined && minutes === undefined) return console.error(`not a length of time: ${every.value} (say 30m or 2h)`), 1
  const all = days.value !== undefined && ['all', 'daily', 'every'].includes(days.value.toLowerCase())
  const on = days.value === undefined || all ? undefined : parseDays(days.value)
  if (days.value !== undefined && !all && !on) return console.error(`not days: ${days.value} (say mon,wed, weekdays, weekends or all)`), 1
  const got = await jobsApi(n, `/schedules/${id}/edit`, {
    ...(prompt.value !== undefined && { prompt: prompt.value }),
    ...(at.value !== undefined && { at: at.value }),
    ...(days.value !== undefined && { days: all ? null : on }),
    ...(minutes !== undefined && { every: minutes }),
    ...(watch.value !== undefined && { quiet: true }),
    ...(always.value !== undefined && { quiet: false }),
  })
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  const s = got.data
  console.log(`Schedule ${bold(s.id)}: ${whenText(s)}${s.quiet ? ', only when something changed' : ''}, next ${nextText(new Date(s.next))}.`)
  console.log(dim(titleOf(s.prompt)))
  return 0
}

/** `navi schedules [<id> run | rm | edit …] [--port N]` (SCH-8, SCH-17). */
async function schedulesCommand(argv: string[]) {
  const port = takeFlag(argv, '--port', true)
  const n = port.value === undefined ? DEFAULT_PORT : Number(port.value)
  const [id, what, ...extra] = port.rest
  if (what === 'edit' && Number.isInteger(n)) return editScheduleCommand(n, id, extra)
  if (extra.length || !Number.isInteger(n) || (id !== undefined && !['run', 'rm', 'pause', 'resume'].includes(what ?? ''))) {
    console.error(SCHEDULES_USAGE)
    return 1
  }
  if (!id) {
    const got = await jobsApi(n, '/schedules')
    if (!got) return console.error(NOT_SERVING), 1
    if (got.status !== 200) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
    const list = got.data.schedules ?? []
    if (!list.length) console.log('No schedules. Add one with `navi schedule "<what you want done>" --at 08:00`.')
    for (const s of list)
      console.log(`${bold(s.id)}  ${`${whenText(s)}${s.quiet ? ' · watch' : ''}`.padEnd(22)}  ${runMarks(s.runs ?? []).padEnd(5)}  ${(s.paused ? (s.stuck ? 'paused: failing' : 'paused') : s.retryAt ? `retry ${nextText(new Date(s.retryAt))}` : `next ${nextText(new Date(s.next))}`).padEnd(20)}  ${titleOf(s.prompt)}`)
    return 0
  }
  const got = await jobsApi(n, `/schedules/${id}/${what === 'rm' ? 'delete' : what}`, {})
  if (!got) return console.error(NOT_SERVING), 1
  if (got.status >= 300) return console.error(got.data.error?.message ?? `navi serve answered ${got.status}`), 1
  if (what === 'rm') console.log(`Deleted schedule ${bold(id)}.`)
  // SCH-21
  else if (what === 'pause') console.log(`Paused schedule ${bold(id)}; \`navi schedules ${id} resume\` starts it again.`)
  else if (what === 'resume') console.log(`Resumed schedule ${bold(id)}: ${whenText(got.data)}, next ${nextText(new Date(got.data.next))}.`)
  else console.log(`Started job ${bold(got.data.id)}. Follow it with \`navi jobs ${got.data.id}\`.`)
  return 0
}

/** `navi push test` (PSH-6). */
async function pushCommand(argv: string[]) {
  if (argv.length !== 1 || argv[0] !== 'test') {
    console.error('usage: navi push test')
    return 1
  }
  const p = pushConfig(await readConfig())
  if (!p) {
    console.error('No push is set up. Install the ntfy app on your phone, subscribe to a long random topic, and add it to ~/.neoai/config.json:')
    console.error(`  "push": "https://ntfy.sh/navi-${randomBytes(9).toString('hex')}"`)
    console.error(dim('Anyone who knows the topic can read what is sent; pushes say only what happened and the job id unless you add "detail": true.'))
    return 1
  }
  const failed = await push(p, { title: 'navi can reach your phone', note: 'This is a test push from navi.' })
  if (failed) return console.error(`The push did not go through: ${failed}.`), 1
  console.log(`Sent a test push to ${p.server}. If it did not show up, check the phone is subscribed to the same topic.`)
  return 0
}

/** `navi memory [add [--project] "<fact>" | forget <n | words>]` (MEM-9 to MEM-11, MEM-17). */
async function memoryCommand(argv: string[]) {
  const home = homedir()
  const project = await projectRoot(process.cwd(), home)
  const [verb, ...rest] = argv
  const forProject = verb === 'add' && rest[0] === '--project'
  const words = (forProject ? rest.slice(1) : rest).join(' ')
  if (forProject && !project) return console.error('There is no project here: run it in one, or add the fact about yourself.'), 1
  if (verb === 'add' && words) {
    const problem = await addFact(home, words, forProject ? project : undefined)
    if (problem) return console.error(problem), 1
    console.log(`remembered${forProject ? ` for ${project}` : ''}: ${words.trim()}`)
    return 0
  }
  const mine = await readMemory(home)
  const theirs = project ? await readMemory(home, project) : []
  // MEM-17: numbered on from the user's, so one number names one fact.
  const all: { fact: string; project?: string }[] = [...mine.map((fact) => ({ fact })), ...theirs.map((fact) => ({ fact, project }))]
  if (verb === 'forget' && words) {
    const same = (x: string) => x.toLowerCase().replace(/\s+/g, ' ')
    const matches = /^\d+$/.test(words.trim())
      ? all.filter((_, i) => i + 1 === Number(words.trim()))
      : all.filter((f) => same(f.fact).includes(same(words.trim())))
    if (matches.length === 1) {
      const got = await forgetFact(home, String((matches[0].project ? theirs : mine).indexOf(matches[0].fact) + 1), matches[0].project)
      if ('removed' in got) return console.log(`forgot${matches[0].project ? ` for ${project}` : ''}: ${got.removed}`), 0
    }
    if (!matches.length) console.error(`Nothing remembered matches ${words}; navi memory lists what there is.`)
    else {
      console.error(`${matches.length} facts match; say which by number:`)
      for (const m of matches) console.error(`  ${all.indexOf(m) + 1}. ${m.fact}`)
    }
    return 1
  }
  if (verb !== undefined) {
    console.error('usage: navi memory [add [--project] "<fact>" | forget <n | words>]')
    return 1
  }
  if (!mine.length) console.log('navi remembers nothing about you yet. Tell it something to remember, or: navi memory add "…"')
  mine.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f}`))
  const config = await readConfig()
  console.log(dim(`${memoryFile(home)}${config.memory === false ? ' · off ("memory": false in the config)' : ''}; edit it by hand if you like`))
  if (project && theirs.length) {
    console.log(`\nAbout ${project}:`)
    theirs.forEach((f, i) => console.log(`${String(mine.length + i + 1).padStart(3)}. ${f}`))
    console.log(dim(`${memoryFile(home, project)}; known only when working here`))
  } else if (project) console.log(dim(`\nNothing remembered about ${project} yet: navi memory add --project "…"`))
  return 0
}

/** Undoes this directory's latest kept turn and says what happened (UND-4 to UND-7, UND-9); whether there was one. */
async function undoHere(cwd: string): Promise<boolean> {
  const got = await undo(homedir(), cwd)
  if (!got) {
    console.error('Nothing to undo here: navi has not changed any files in this directory.')
    return false
  }
  // LED-9: what the user thought of those changes.
  if ((await readConfig()).ledger !== false) await recordUndone(homedir(), got.turns, got.restored.length + got.removed.length > 0)
  const [turn] = got.turns
  console.error(dim(`undoing the turn that began "${turn.prompt}" (${ago(new Date(turn.at))})`))
  for (const l of undoneReport(got).lines) console.error(l.startsWith('not undone') ? dim(`  ${l}`) : `  ${l}`)
  return true
}

/** UND-14, UND-16 */
async function redoHere(cwd: string): Promise<boolean> {
  const got = await redo(homedir(), cwd)
  if (!got) {
    console.error('Nothing to redo here: undo something first. A change navi makes after an undo ends what can be redone.')
    return false
  }
  console.error(dim(`redoing the turn that began "${got.turns[0].prompt}"${got.turns.length > 1 ? ` and ${got.turns.length - 1} after it` : ''}`))
  for (const l of redoneLines(got)) console.error(l.startsWith('not run') ? dim(`  ${l}`) : `  ${l}`)
  return true
}

/** `navi redo [-C <directory>]` (UND-16). */
async function redoCommand(argv: string[]) {
  const dir = takeFlag(argv, '-C', true)
  if (dir.rest.length || dir.value === '') {
    console.error('usage: navi redo [-C <directory>]')
    return 1
  }
  return (await redoHere(resolve(dir.value ?? process.cwd()))) ? 0 : 1
}

/** `navi undo [--list] [-C <directory>]` (UND-8). */
async function undoCommand(argv: string[]) {
  const list = takeFlag(argv, '--list', false)
  const dir = takeFlag(list.rest, '-C', true)
  if (dir.rest.length || dir.value === '') {
    console.error('usage: navi undo [--list] [-C <directory>]')
    return 1
  }
  const cwd = resolve(dir.value ?? process.cwd())
  if (list.value === undefined) return (await undoHere(cwd)) ? 0 : 1
  const turns = await listUndo(homedir(), cwd)
  if (!turns.length) return console.error('Nothing to undo here: navi has not changed any files in this directory.'), 1
  const name = await namer(cwd)
  turns.forEach((t, i) => {
    console.log(`${i === 0 ? bold('next') : `${i + 1}.`.padStart(4)} ${ago(new Date(t.at))} · ${t.prompt}`)
    const files = [...new Set(t.changes.map((c) => name(c.path)))]
    console.log(dim(`     ${files.join(', ')}${t.commands.length ? ` · ${t.commands.length} shell command${t.commands.length === 1 ? '' : 's'}` : ''}`))
  })
  return 0
}

/** `navi stats [--days N]`: how each model has done (LED-6). */
async function showStats(argv: string[]) {
  const days = argv[0] === '--days' && argv.length === 2 ? Number(argv[1]) : argv.length ? NaN : 30
  if (!Number.isInteger(days) || days < 1) {
    console.error(`unexpected: ${argv.join(' ')}`)
    console.error('usage: navi stats [--days N]')
    return 1
  }
  const since = Date.now() - days * 86_400_000
  console.log(stats(await readLedger(homedir(), since), days, await readUndone(homedir(), since)))
  return 0
}

/** `navi browser [--install]`: opens navi's browser for signing in, or installs Chromium for it (BRW-12). */
async function browser(argv: string[]) {
  const install = takeFlag(argv, '--install', false)
  if (install.rest.length) {
    console.error(`unexpected: ${install.rest.join(' ')}`)
    console.error('usage: navi browser [--install]')
    return 1
  }
  const config = await readConfig()
  const executable = await configuredBrowser(homedir())
  // A configured browser that is missing is the user's to fix, not a reason to install another.
  const found = await findBrowser(executable).catch((e: Error) => e)
  if (found instanceof Error) {
    console.error(found.message)
    return 1
  }
  if (install.value !== undefined || !found) {
    console.error('Installing Chromium for navi…')
    if (!(await installBrowser())) {
      console.error('Chromium could not be installed; the reason is above.')
      return 1
    }
    if (install.value !== undefined) return 0
  }
  try {
    await showBrowser({ home: homedir(), executable })
  } catch (e) {
    console.error(`navi's browser did not open: ${(e as Error).message}`)
    return 1
  }
  await disconnect(homedir())
  console.log("navi's browser is open. Sign in to the sites you want navi to use; it keeps the logins.")
  console.log(dim(`It is separate from your own browser, with its profile in ~/.neoai/browser.`))
  if (config.browser === false || config.web_search === false)
    console.error(dim(`Its tools are off in ~/.neoai/config.json ("${config.browser === false ? 'browser' : 'web_search'}": false).`))
  return 0
}

/** `navi sessions [clear [<directory> | --all]]` (SES-13, SES-14). */
async function sessions(argv: string[]) {
  const home = homedir()
  const cwd = process.cwd()
  const tilde = (p: string) => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
  if (!argv.length) {
    const all = await listSessions(home)
    if (!all.length) {
      console.log('No saved conversations yet.')
      return 0
    }
    const here = sessionFile(cwd, home)
    for (const s of all) {
      const mark = s.file === here ? '*' : ' '
      const where = s.cwd ? tilde(s.cwd) : `(directory unknown) ${s.file}`
      console.log(`${mark} ${where}  ${dim(`${s.messages} messages · ${ago(s.used)}`)}`)
    }
    console.log(dim('\n* this directory · read one with `navi sessions show [<directory>]` · clear one with `navi sessions clear [<directory>]`, all with `--all`'))
    return 0
  }
  if (argv[0] === 'show' && argv.length <= 2) {
    // SES-15, SES-16: plain Markdown on stdout, to read or to keep.
    const typed = resolve(cwd, argv[1] ?? '.')
    const dir = await realpath(typed).catch(() => typed)
    const messages = await loadSession(sessionFile(dir, home))
    if (!messages.length) return console.error(`No conversation is saved for ${tilde(dir)}.`), 1
    process.stdout.write(transcript(messages, tilde(dir)))
    return 0
  }
  if (argv[0] === 'clear' && argv.length <= 2) {
    if (argv[1] === '--all') {
      const n = await clearAllSessions(home)
      console.log(n ? `Deleted ${n} saved conversation${n === 1 ? '' : 's'}.` : 'There were no saved conversations.')
      return 0
    }
    // Saved under the real path, as process.cwd() gives it: /tmp is /private/tmp on macOS.
    const typed = resolve(cwd, argv[1] ?? '.')
    const dir = await realpath(typed).catch(() => typed)
    const had = await clearSession(dir, home)
    console.log(had ? `Deleted the conversation saved for ${tilde(dir)}.` : `No conversation is saved for ${tilde(dir)}.`)
    return 0
  }
  console.error(`unexpected: ${argv.join(' ')}`)
  console.error('usage: navi sessions [show [<directory>] | clear [<directory> | --all]]')
  return 1
}

async function main() {
  let argv = process.argv.slice(2)
  if (argv.length === 1 && ['-h', '--help', 'help'].includes(argv[0])) {
    console.log(`${USAGE}\n\n${ABOUT}`)
    return 0
  }
  if (argv[0] === 'setup') return setup(argv.slice(1))
  if (argv[0] === 'sessions') return sessions(argv.slice(1))
  if (argv[0] === 'serve') return serve(argv.slice(1))
  if (argv[0] === 'mcp') return mcp(argv.slice(1))
  if (argv[0] === 'browser') return browser(argv.slice(1))
  if (argv[0] === 'stats') return showStats(argv.slice(1))
  if (argv[0] === 'job') return startJobCommand(argv.slice(1))
  if (argv[0] === 'jobs') return jobsCommand(argv.slice(1))
  if (argv[0] === 'schedule') return scheduleCommand(argv.slice(1))
  if (argv[0] === 'push') return pushCommand(argv.slice(1))
  if (argv[0] === 'schedules') return schedulesCommand(argv.slice(1))
  if (argv[0] === 'memory') return memoryCommand(argv.slice(1))
  if (argv[0] === 'undo') return undoCommand(argv.slice(1))
  if (argv[0] === 'redo') return redoCommand(argv.slice(1))
  const steps = takeFlag(argv, '--max-steps', true)
  argv = steps.rest
  const resume = takeFlag(argv, '--resume', false)
  argv = resume.rest
  const r = takeFlag(argv, '-r', false)
  argv = r.rest
  const resuming = resume.value !== undefined || r.value !== undefined
  const model = takeFlag(argv, '--model', true)
  argv = model.rest
  const attaching = takeAll(argv, ['-a', '--attach'])
  argv = attaching.rest

  // A terminal gets a conversation; a pipe gets one answer and the prompt is
  // the only place it can come from.
  const interactive = process.stdin.isTTY === true
  const maxSteps = steps.value === undefined ? DEFAULT_STEPS : Number(steps.value)
  const { prompt: first, stray } = promptFrom(argv)
  const badSteps = !Number.isInteger(maxSteps) || maxSteps < 1
  if (stray.length || badSteps || (!first && !interactive)) {
    if (stray.length) console.error(`unexpected: ${stray.join(' ')}`)
    else if (badSteps) console.error(`not a step count: ${steps.value}`)
    console.error(USAGE)
    return 1
  }

  // Read before any model is looked for: a bad path should not cost a model start (CLI-22).
  let pending: Attachment[] = []
  for (const path of attaching.values) {
    try {
      pending.push(path === '-' ? await attachStdin(process.stdin) : await attach(path))
    } catch (e) {
      console.error(`navi: ${(e as Error).message}`)
      return 1
    }
  }

  // --model overrides the config file for one run; both take the same values.
  const config = await readConfig()
  const custom = Object.keys(config.custom ?? {})
  const saved = parseModelSpec(config.model, custom)
  let chain = model.value === undefined ? saved : parseModelSpec(model.value, custom)
  const { chosen, failures } = await walkChain(chain)
  if (!chosen) {
    console.error('navi has no model to answer with:')
    for (const line of failedLines(failures)) console.error(`  ${line}`)
    console.error(CLI_NEXT_STEP)
    return 1
  }
  // Why each earlier link did not answer (MOD-21): on stderr, so pipes still
  // get exactly the answer.
  for (const line of failedLines(failures)) console.error(dim(`· ${line}`))

  const cwd = process.cwd()
  const file = sessionFile(cwd, homedir())
  const anew = startsFresh({ prompt: first, resume: resuming })
  const stored = anew ? [] : await loadSession(file)
  if (stored.length) console.error(dim(`· continuing (${stored.length} messages)`))

  let adding: Promise<void> = Promise.resolve()
  // The turn running now, which ^C stops (CLI-25).
  let running = null as AbortController | null
  const line = makeLine({
    input: process.stdin,
    output: process.stdout,
    onInterrupt: () => {
      if (!running || running.signal.aborted) return false
      running.abort()
      return true
    },
    // A history that cannot be written is only a convenience lost.
    // One write at a time, each merged with the file; one that fails is only a convenience lost.
    history: { prompts: await loadPrompts(homedir()), add: (p) => void (adding = adding.then(() => addPrompt(homedir(), p)).catch(() => {})) },
  })
  // Killed rather than left: the terminal gets its normal paste mode back (CLI-26).
  for (const [signal, code] of [['SIGTERM', 143], ['SIGHUP', 129]] as const)
    process.once(signal, () => {
      line.close()
      process.exit(code)
    })
  const spin = makeSpinner(process.stderr)
  const asker = makeApprover({ line })
  // On a terminal the answer is written as it arrives; a pipe gets exactly the
  // final answer, as before streaming.
  const streaming = process.stdout.isTTY === true
  // Streamed text not yet ended by a newline: anything else drawn now would
  // land on the end of it.
  let midLine = false
  const endLine = () => {
    if (midLine) process.stdout.write('\n')
    midLine = false
  }
  const harnessFor = (chosen: Chosen) => createHarness({
    model: modelFor(chosen, config),
    contextWindow: chosen.contextWindow,
    cwd,
    config,
    front: 'cli',
    name: { model: modelLabel(chosen), local: chosen.local },
    escalate: escalationFor(config),
    maxSteps,
    browser: () => makeTab({ home: homedir() }),
    // The question would otherwise be drawn beside a spinning frame.
    approve: async (command, { change, action, memory, project, signal }) => {
      spin.stop()
      endLine()
      const ok = change
        ? await asker.approveChange(command, change, signal)
        : action
          ? await asker.approveAction(command, action.url, signal)
          : memory !== undefined
            ? await asker.approveMemory(memory, signal, project)
            : await asker.approve(command, signal)
      spin.start()
      return ok
    },
  })
  let answering = chosen
  let session = (await harnessFor(chosen)).session(stored)

  /** CLI-20: what answers and the saved chain, or a switch that keeps the conversation. */
  const switchModel = async (spec: string) => {
    if (!spec) {
      console.error(describe({ ...answering, label: modelLabel(answering) }))
      console.error(dim(`saved chain: ${saved.map(entryLabel).join(' → ')}`))
      if (chain !== saved) console.error(dim(`this session: ${chain.map(entryLabel).join(' → ')}`))
      console.error(dim('switch with /model <provider>:<model>, local, best, or a list separated by commas'))
      return
    }
    // Looked at afresh: the user may have just started the server that failed.
    reset()
    const wanted = parseModelSpec(spec, custom)
    const next = await walkChain(wanted)
    if (!next.chosen) {
      console.error(`nothing in ${spec} answers, so the model stays ${modelLabel(answering)}:`)
      for (const line of failedLines(next.failures)) console.error(`  ${line}`)
      return
    }
    answering = next.chosen
    chain = wanted
    session = (await harnessFor(answering)).session(session.history)
    console.error(describe({ ...answering, label: modelLabel(answering) }))
  }

  /** A note on stderr, never over a spinner frame or the end of streamed text. */
  const note = (s: string) => {
    endLine()
    console.error(dim(s))
  }

  /** One question in, one answer out. Returns whether the model said anything. */
  const turn = async (prompt: string) => {
    let done: Extract<HarnessEvent, { type: 'done' }> | undefined
    const stop = new AbortController()
    running = stop
    spin.start()
    try {
      // Attachments go with the next prompt only (CLI-22, CLI-23).
      const attachments = pending
      pending = []
      for await (const e of session.turn(prompt, { attachments, signal: stop.signal })) {
        if (e.type === 'done') done = e
        else if (e.type === 'text') {
          // Unstreamed text waits for the end; the spinner keeps going meanwhile.
          if (!streaming || !e.text) continue
          // Never restarted while text is streaming: the frame would draw over it.
          spin.stop()
          process.stdout.write(e.text)
          midLine = !e.text.endsWith('\n')
        } else {
          spin.stop()
          if (e.type === 'compacted') note(`· compacted ${e.messages} messages`)
          else if (e.type === 'tool-call') note(`· ${e.name}(${echo(e.input)})`)
          else if (e.type === 'auto-approved') note(`· ${e.allowed ? 'allowed' : 'auto-approved'}: ${e.command}`)
          else if (e.type === 'remembered')
            note(
              e.problem
                ? `· allowed for this session only: ${e.command} (could not save it: ${e.problem})`
                : `· allowed from now on: ${e.command} (\`allow\` in ~/.neoai/config.json)`,
            )
          else if (e.type === 'error') note(`error: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
          // ESC-5: said where the user sees model announcements, REMOTE called out (CLI-15).
          else if (e.type === 'escalated') note(`· escalated to ${e.to}${e.local ? '' : ' (REMOTE: prompts leave this computer)'}: ${e.reason}`)
          // The model or a tool is busy again.
          endLine()
          spin.start()
        }
      }
    } finally {
      running = null
      spin.stop()
    }
    endLine()
    // Saved even when the answer came out empty: the tool results are the part
    // worth carrying forward, and a follow-up is how you recover from a bad turn.
    await saveSession(file, done!.history, cwd)
    if (done!.stopped) {
      if (!streaming && !done!.empty) console.log(done!.text)
      console.error(dim('· stopped'))
      return !done!.empty
    }
    if (!done!.empty) {
      if (!streaming) console.log(done!.text)
      // HAR-11: an answer that ends mid-thought says why.
      if (done!.cut) console.error(dim(CUT_NOTE))
      return true
    }
    console.error(dim('the model returned no answer; ask again'))
    return false
  }

  try {
    if (!first) console.error(dim('navi · ask anything; /help for commands; exit, ^C or ^D to leave'))
    // On a terminal, ^C during the first turn stops it rather than killing navi (CLI-25).
    if (interactive) line.listen()
    if (first) {
      const answered = await turn(first)
      if (!interactive) return answered ? 0 : 1
    }
    for (;;) {
      // The marker gets a lighter background; bold is opened as part of the
      // prompt so the typed line inherits it.
      const prompt = (await line.ask(`\n${highlight('navi>')} \x1b[1m`, {
        // Leaving is not worth recalling.
        remember: (l) => !QUIT.has(l.trim().toLowerCase()),
      }))?.trim()
      // Reset the bold, and a blank line between what was asked and what comes back.
      if (process.stdout.isTTY) process.stdout.write('\x1b[0m\n')
      if (prompt === undefined || prompt === null || QUIT.has(prompt.toLowerCase())) return 0
      if (!prompt) continue
      const command = commandFrom(prompt)
      if (command?.name === 'model') await switchModel(command.spec)
      else if (command?.name === 'help') console.error(HELP)
      else if (command?.name === 'undo') await undoHere(cwd)
      else if (command?.name === 'redo') await redoHere(cwd)
      else if (command?.name === 'attach' && !command.path) console.error('usage: /attach <file>')
      else if (command?.name === 'attach') {
        try {
          const a = await attach(command.path)
          pending.push(a)
          const as = a.kind === 'pages' ? ` (${a.pages.length < a.of ? `the first ${a.pages.length} of ${a.of}` : a.of} scanned page${a.of === 1 ? '' : 's'}, as images)` : ''
          console.error(dim(`· attached ${a.name}${as}; it goes with your next prompt`))
        } catch (e) {
          console.error(`can't attach: ${(e as Error).message}`)
        }
      }
      else await turn(prompt)
    }
  } finally {
    line.close()
  }
}

process.exit(await main())
