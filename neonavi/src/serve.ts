import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { access, constants, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { ReadableStream as WebStream } from 'node:stream/web'
import { CallError, detailOf, diagnose, PROVIDERS, readConfig, reset, route, troubleOf, type Route } from 'neorouter'
import { capTokens, linkOptions, optionsFor, troubleIn, type Entry, type LinkOptions } from './spec.ts'
import { slotName } from './setup-core.ts'
import { timingSafeEqual } from 'node:crypto'
import { stat as statPath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { working, type Job, type Jobs } from './jobs.ts'
import { checkWhen, type Schedules } from './schedules.ts'
import { addFact, forgetFact, projectRoot, readMemory } from './memory.ts'
import { exchanges, turnImage } from './transcript.ts'
import type { Suggestion } from './suggest.ts'
import type { ModelMessage } from 'ai'
import { PHONE_PAGE } from './phone.ts'
import { attachUploads } from './attach.ts'
import { jobChanges, undo, undoneReport } from './undo.ts'
import { recordUndone } from './ledger.ts'
import { homedir } from 'node:os'
import { configDir } from 'neorouter'
import { loadConfig, updateConfig } from './setup-core.ts'
import { LEVELS, notifyLevels, withLevels, type Level } from './push.ts'

/** What the server needs from the world; the real ones by default, fakes in tests. */
export interface ServeDeps {
  /** `think` from the link's options (SRV-9): false asks the model not to think (MOD-50). */
  route: (entry: Entry, think?: boolean) => Promise<Route | null>
  /** The link's options in `"modelOptions"`, read afresh each request (SRV-9); none when left out. */
  options?: (entry: Entry) => Promise<LinkOptions>
  /** Why a link resolved to nothing (MOD-21). */
  why: (entry: Entry) => Promise<string>
  fetch: typeof fetch
  /** Forget resolutions, so a link that failed is looked at afresh. */
  forget: () => void
  log: (line: string) => void
}

export const DEFAULT_PORT = 8484
/** An image or two in a request is fine; a runaway client is not. */
const MAX_BODY = 50 * 1024 * 1024

export function realServeDeps(log: (line: string) => void): ServeDeps {
  return {
    route: (entry, think) => route({ ...optionsFor(entry), ...(think !== undefined && { think }) }),
    options: async (entry) => {
      const config = await readConfig()
      return linkOptions(entry, config.modelOptions, Object.keys((config.custom as object | undefined) ?? {}))
    },
    why: async (entry) => (await diagnose(optionsFor(entry))) ?? 'it did not answer',
    fetch,
    forget: reset,
    log,
  }
}

function error(res: ServerResponse, status: number, message: string, type = 'invalid_request_error') {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message, type } }))
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    // Read to the end even when too big, so the 413 can still be sent.
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= MAX_BODY) chunks.push(c)
    })
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** One link in words, for logs and errors: "the model (Darkbloom:qwen3)", by its slot (MOD-44). */
function linkName(entry: Entry, index: number): string {
  const slot = slotName(index)
  const what = entry.where === 'local' ? (entry.id ?? 'local') : `${entry.provider}${entry.id ? `:${entry.id}` : ''}`
  return `${slot} (${what})`
}

/** Jobs, and how a listener reaches them (jobs.md). */
export interface JobsOptions {
  jobs: Jobs
  /** The token every jobs request needs (JOB-8). */
  token: string
  /** Directories to offer as places to work (JOB-7). */
  directories: () => Promise<string[]>
  /** Jobs started by themselves (schedules.md). */
  schedules?: Schedules
  /** Where undo keeps jobs' changes (UND-10) and memory is (MEM-12); the user's home when left out. */
  home?: string
  /** False when the config turns memory off (MEM-4). */
  memory?: boolean
  /** Facts worth remembering from what a job's user typed (MEM-23); none offered when left out. */
  suggest?: (history: ModelMessage[], known: { you: string[]; project?: string[] }) => Promise<Suggestion[]>
}

/** Whether a request carries the token, compared in constant time (JOB-8). */
function bearer(req: IncomingMessage, token: string): boolean {
  const got = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown> | string> {
  const raw = await readBody(req)
  if (!raw) return 'The request is larger than 50 MB.'
  try {
    const body = JSON.parse(raw.toString('utf8') || '{}')
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch {
    // Said below.
  }
  return 'The body is not a JSON object.'
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))

/** JOB-9: somewhere real to work, named in full; the first offered when none is given. */
async function placeFor(given: unknown, o: JobsOptions): Promise<string | undefined> {
  const directory = given ?? (await o.directories())[0]
  if (typeof directory !== 'string' || !isAbsolute(directory)) return
  return (await statPath(directory).then((s) => s.isDirectory(), () => false)) ? directory : undefined
}

/** The memory API (MEM-12, MEM-18); the token is already checked. */
async function memoryRoute(req: IncomingMessage, res: ServerResponse, path: string, o: JobsOptions) {
  const home = o.home ?? homedir()
  // MEM-18: the projects of the directories offered, each once, and only those.
  const roots = async () => [...new Set((await Promise.all((await o.directories()).map((d) => projectRoot(d, home)))).filter((r) => r !== undefined))]
  const now = async () => ({
    facts: await readMemory(home),
    off: o.memory === false,
    projects: await Promise.all((await roots()).map(async (root) => ({ root, facts: await readMemory(home, root) }))),
  })
  if (req.method === 'GET' && path === '/memory') return json(res, 200, await now())
  if (req.method === 'POST' && (path === '/memory' || path === '/memory/forget')) {
    const body = await jsonBody(req)
    if (typeof body === 'string') return error(res, 400, body)
    if (typeof body.fact !== 'string') return error(res, 400, 'Give the fact as { "fact": "…" }.')
    const project = body.project
    if (project !== undefined && (typeof project !== 'string' || !(await roots()).includes(project)))
      return error(res, 400, 'That is not a project navi serve offers; GET /memory lists them.')
    if (path === '/memory') {
      // MEM-10: sending it is the yes.
      const problem = await addFact(home, body.fact, project)
      return problem ? error(res, 400, problem) : json(res, 201, await now())
    }
    // Exactly that fact, never one that merely contains it.
    const at = (await readMemory(home, project)).indexOf(body.fact.trim())
    if (at < 0) return error(res, 404, 'That fact is not remembered (any more).')
    await forgetFact(home, String(at + 1), project)
    return json(res, 200, await now())
  }
  error(res, 404, `Memory answers GET /memory, POST /memory and POST /memory/forget, not ${req.method} ${path}.`)
}

/** What the Mac and the phone are told (JOB-40); the token is already checked. */
async function settingsRoute(req: IncomingMessage, res: ServerResponse, path: string, o: JobsOptions) {
  const dir = configDir(o.home ?? homedir())
  if (path !== '/settings/notify' || (req.method !== 'GET' && req.method !== 'POST'))
    return error(res, 404, `Settings answer GET and POST /settings/notify, not ${req.method} ${path}.`)
  if (req.method === 'POST') {
    const body = await jsonBody(req)
    if (typeof body === 'string') return error(res, 400, body)
    const set: { mac?: Level; phone?: Level } = {}
    for (const k of ['mac', 'phone'] as const) {
      const v = body[k]
      if (v === undefined) continue
      if (!LEVELS.includes(v as Level)) return error(res, 400, `Give ${k} as all, waiting or off.`)
      set[k] = v as Level
    }
    let problem = ''
    await updateConfig((config) => {
      const next = withLevels(config, set)
      return typeof next === 'string' ? ((problem = next), config) : next
    }, dir)
    if (problem) return error(res, 400, problem)
  }
  json(res, 200, notifyLevels(await loadConfig(dir)))
}

/** The schedules API (SCH-7); the token is already checked. */
async function schedulesRoute(req: IncomingMessage, res: ServerResponse, path: string, o: JobsOptions, schedules: Schedules) {
  const parts = path.split('/').slice(2)
  if (req.method === 'GET' && !parts.length) {
    // SCH-22: how its last few runs went, and nothing more of them.
    const jobs = o.jobs.list()
    const runs = (id: string) =>
      jobs.filter((j) => j.schedule === id).slice(0, 5).map((j) => ({ id: j.id, status: j.status, created: j.created, ...(j.unchanged && { unchanged: true }) }))
    return json(res, 200, { schedules: schedules.list().map((s) => ({ ...s, runs: runs(s.id) })) })
  }
  if (req.method !== 'POST') return error(res, 404, `Schedules answer GET /schedules, POST /schedules and POST /schedules/<id>/run, edit, pause, resume or delete, not ${req.method} ${path}.`)
  const body = await jsonBody(req)
  if (typeof body === 'string') return error(res, 400, body)
  if (!parts.length) {
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) return error(res, 400, 'Give the schedule a prompt.')
    const when = { at: body.at, days: body.days, every: body.every } as Parameters<typeof checkWhen>[0]
    const wrong = checkWhen(when)
    if (wrong) return error(res, 400, wrong)
    const directory = await placeFor(body.directory, o)
    if (!directory) return error(res, 400, `${String(body.directory)} is not a directory on this computer; give an absolute path.`)
    if (body.quiet !== undefined && typeof body.quiet !== 'boolean') return error(res, 400, 'quiet is true or false.')
    const made = await schedules.add(body.prompt.trim(), directory, when, body.quiet === true)
    return json(res, 201, schedules.list().find((s) => s.id === made.id))
  }
  if (!schedules.get(parts[0])) return error(res, 404, `There is no schedule ${parts[0]}.`)
  if (parts[1] === 'run' && parts.length === 2) {
    const job = await schedules.run(parts[0])
    return json(res, 201, job && o.jobs.get(job))
  }
  if ((parts[1] === 'pause' || parts[1] === 'resume') && parts.length === 2) {
    // SCH-20
    await schedules.pause(parts[0], parts[1] === 'pause')
    return json(res, 200, schedules.list().find((s) => s.id === parts[0]))
  }
  if (parts[1] === 'edit' && parts.length === 2) {
    // SCH-16: only what is given changes.
    const had = schedules.get(parts[0])!
    if (body.prompt !== undefined && (typeof body.prompt !== 'string' || !body.prompt.trim())) return error(res, 400, 'A prompt cannot be empty.')
    if (body.quiet !== undefined && typeof body.quiet !== 'boolean') return error(res, 400, 'quiet is true or false.')
    let when: Parameters<typeof checkWhen>[0] | undefined
    if (body.at !== undefined || body.every !== undefined) when = { at: body.at, days: body.days ?? undefined, every: body.every } as Parameters<typeof checkWhen>[0]
    else if (body.days !== undefined) {
      if (had.at === undefined) return error(res, 400, 'days go with at, not every.')
      when = { at: had.at, days: body.days ?? undefined } as Parameters<typeof checkWhen>[0]
    }
    const wrong = when && checkWhen(when)
    if (wrong) return error(res, 400, wrong)
    if (body.prompt === undefined && !when && body.quiet === undefined) return error(res, 400, 'Say what to change: prompt, at, days, every or quiet.')
    await schedules.edit(parts[0], { ...(body.prompt !== undefined && { prompt: body.prompt.trim() }), ...(when && { when }), ...(body.quiet !== undefined && { quiet: body.quiet }) })
    return json(res, 200, schedules.list().find((s) => s.id === parts[0]))
  }
  if (parts[1] === 'delete' && parts.length === 2) {
    await schedules.remove(parts[0])
    return json(res, 200, { deleted: parts[0] })
  }
  error(res, 404, `Schedules answer GET /schedules, POST /schedules and POST /schedules/<id>/run, edit, pause, resume or delete, not ${req.method} ${path}.`)
}

/** A job as the API shows it: never its conversation, which can hold whole photos (JOB-15). */
const shownJob = ({ history: _h, turn: _t, ...rest }: Job) => rest

/** The jobs API (JOB-7); the token is already checked. */
async function jobsRoute(req: IncomingMessage, res: ServerResponse, path: string, o: JobsOptions) {
  const { jobs } = o
  const parts = path.split('/').slice(2)
  if (req.method === 'GET' && !parts.length) return json(res, 200, { jobs: jobs.list() })
  if (req.method === 'GET' && parts.length === 1 && parts[0] === 'directories') return json(res, 200, { directories: await o.directories() })
  if (req.method === 'POST' && !parts.length) {
    const body = await jsonBody(req)
    if (typeof body === 'string') return error(res, 400, body)
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) return error(res, 400, 'Give the job a prompt.')
    const directory = await placeFor(body.directory, o)
    if (!directory) return error(res, 400, `${String(body.directory)} is not a directory on this computer; give an absolute path.`)
    // JOB-14: every file attached, or no job.
    const attachments = body.files === undefined ? [] : await attachUploads(body.files)
    if (typeof attachments === 'string') return error(res, 400, attachments)
    return json(res, 201, shownJob(jobs.create(body.prompt.trim(), directory, { attachments })))
  }
  // JOB-25: every job that is done with.
  if (req.method === 'POST' && parts.length === 1 && parts[0] === 'clear') return json(res, 200, { cleared: await jobs.clear() })
  const job = parts[0] ? jobs.get(parts[0]) : undefined
  if (!job) return error(res, 404, `There is no job ${parts[0] ?? ''}.`)
  const home = o.home ?? homedir()
  // JOB-27: what was asked and answered, a turn each, never the conversation itself.
  if (req.method === 'GET' && parts.length === 1) {
    const turns = exchanges(job.history)
    // A follow-up is in the conversation only once it ends well; until then, or if it failed, what it asked.
    if (job.asked && turns.length && turns[turns.length - 1].prompt !== job.asked) turns.push({ prompt: job.asked })
    // MEM-23: whether the phone may ask what is worth remembering from it.
    const suggests = !!o.suggest && o.memory !== false && !working(job.status) && turns.length > 0
    return json(res, 200, { ...shownJob(job), changes: await jobChanges(home, job.directory, job.id), turns, ...(suggests && { suggests }) })
  }
  // PSH-17: the page a waiting browser action is on.
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'page.jpg') {
    const jpeg = jobs.shot(job.id)
    if (!jpeg) return error(res, 404, 'There is no picture of a page for this job now.')
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpeg.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    return res.end(jpeg)
  }
  // JOB-37: a photo sent with a turn, so the phone can show it there; only the kinds a browser draws without running anything.
  if (req.method === 'GET' && parts.length === 5 && parts[1] === 'turns' && parts[3] === 'images') {
    const got = turnImage(job.history, Number(parts[2]), Number(parts[4]))
    if (!got || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(got.mediaType)) return error(res, 404, 'There is no such photo.')
    const bytes = Buffer.from(got.data, 'base64')
    res.writeHead(200, { 'content-type': got.mediaType, 'content-length': bytes.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
    return res.end(bytes)
  }
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'suggest') {
    if (!o.suggest || o.memory === false) return error(res, 400, 'Memory is off, or navi serve suggests nothing.')
    if (working(job.status)) return error(res, 400, 'The job is still working; wait for it, or stop it.')
    // MEM-24: a project fact only for a project navi serve offers, which POST /memory takes.
    const root = await projectRoot(job.directory, home)
    const offered = root !== undefined && (await Promise.all((await o.directories()).map((d) => projectRoot(d, home)))).includes(root)
    const known = { you: await readMemory(home), ...(offered && { project: await readMemory(home, root) }) }
    const found = await o.suggest(job.history, known)
    return json(res, 200, { suggestions: found.filter((s) => offered || !s.project).map((s) => ({ fact: s.fact, ...(s.project && { project: root }) })) })
  }
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'undo') {
    // UND-11: not while it may still be writing.
    if (working(job.status)) return error(res, 400, 'The job is still working; stop it or wait for it first.')
    const got = await undo(home, job.directory, job.id)
    if (!got) return error(res, 400, 'Nothing of this job is left to undo.')
    // LED-9
    if ((await readConfig()).ledger !== false) await recordUndone(home, got.turns, got.restored.length + got.removed.length > 0)
    const report = undoneReport(got)
    await jobs.note(job.id, ['↶ undone:', ...report.lines.map((l) => `  ${l}`)])
    return json(res, 200, report)
  }
  if (req.method === 'POST' && parts.length === 2) {
    const body = await jsonBody(req)
    if (typeof body === 'string') return error(res, 400, body)
    if (parts[1] === 'answer') {
      if (typeof body.yes !== 'boolean') return error(res, 400, 'Answer with { "yes": true } or { "yes": false }.')
      return jobs.answer(job.id, body.yes) ? json(res, 200, shownJob(jobs.get(job.id)!)) : error(res, 400, 'The job is not waiting on an approval.')
    }
    if (parts[1] === 'reply') {
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) return error(res, 400, 'Give the follow-up a prompt.')
      if (working(job.status)) return error(res, 400, 'The job is still working; wait for it, or stop it.')
      // JOB-19: every file attached, or no follow-up.
      const attachments = body.files === undefined ? [] : await attachUploads(body.files)
      if (typeof attachments === 'string') return error(res, 400, attachments)
      return jobs.reply(job.id, body.prompt.trim(), attachments) ? json(res, 200, shownJob(jobs.get(job.id)!)) : error(res, 400, 'The job is still working; wait for it, or stop it.')
    }
    if (parts[1] === 'schedule' && o.schedules) {
      // JOB-32: its first prompt, where it ran, as POST /schedules makes one.
      if (working(job.status)) return error(res, 400, 'The job is still working; wait for it, or stop it.')
      const when = { at: body.at, days: body.days, every: body.every } as Parameters<typeof checkWhen>[0]
      const wrong = checkWhen(when)
      if (wrong) return error(res, 400, wrong)
      if (body.quiet !== undefined && typeof body.quiet !== 'boolean') return error(res, 400, 'quiet is true or false.')
      const made = await o.schedules.add(job.prompt, job.directory, when, body.quiet === true)
      return json(res, 201, o.schedules.list().find((s) => s.id === made.id))
    }
    // JOB-42
    if (parts[1] === 'retry') {
      const why = jobs.retry(job.id)
      return why ? error(res, 400, why) : json(res, 200, shownJob(jobs.get(job.id)!))
    }
    if (parts[1] === 'stop') return jobs.stop(job.id) ? json(res, 200, shownJob(jobs.get(job.id)!)) : error(res, 400, 'The job is not running.')
    // JOB-24
    if (parts[1] === 'delete') return (await jobs.remove(job.id)) ? json(res, 200, { deleted: job.id }) : error(res, 400, 'The job is still working; stop it first.')
  }
  error(res, 404, `Jobs answer GET /jobs, POST /jobs, POST /jobs/clear, GET /jobs/<id> and POST /jobs/<id>/answer, reply, retry, stop, undo, suggest, schedule or delete, not ${req.method} ${path}.`)
}

/**
 * The request handler for SRV-2 to SRV-7, over the chain navi resolves, and
 * jobs when given (JOB-7). `remote` is a listener on the tailnet (JOB-10),
 * where every request needs the token.
 */
export function serveHandler(chain: Entry[], d: ServeDeps, o: { jobs?: JobsOptions; remote?: boolean } = {}) {
  /** Posts to one link; a 400 over what navi added (the switch that turns thinking off, a second cap) is asked once more without it, as navi does. */
  async function send(r: Route, body: Record<string, unknown>, signal: AbortSignal, o: LinkOptions = {}): Promise<Response> {
    // SRV-9: the link's cap and temperature where the app asked for none; what it asked for wins.
    const capped = 'max_tokens' in body || 'max_completion_tokens' in body
    const sent: Record<string, unknown> = {
      ...r.extra,
      ...(o.maxTokens !== undefined && !capped && { max_tokens: o.maxTokens }),
      ...(o.temperature !== undefined && { temperature: o.temperature }),
      ...body,
      model: r.model,
    }
    // What navi added that a server may refuse, and the word its refusal would use.
    const added: [string, RegExp][] = (
      [
        ['reasoning_effort', /reasoning/i],
        ['thinking', /thinking/i],
      ] as [string, RegExp][]
    ).filter(([k]) => k in r.extra && !(k in body))
    // SRV-10: but never past the link's hard cap, however the app asks.
    if (o.tokenCap !== undefined) {
      for (const k of ['max_tokens', 'max_completion_tokens'])
        if (k in sent) sent[k] = typeof sent[k] === 'number' ? capTokens(sent[k], o) : o.tokenCap
      // Not every server reads max_completion_tokens, so the cap goes as max_tokens too.
      if (!('max_tokens' in sent)) {
        sent.max_tokens = sent.max_completion_tokens ?? o.tokenCap
        if ('max_completion_tokens' in sent) added.push(['max_tokens', /max_tokens/i])
      }
    }
    const post = (b: Record<string, unknown>) => d.fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(b), signal })
    const answer = await post(sent)
    if (answer.status !== 400 || !added.length) return answer
    const text = await answer.text()
    const refused = added.filter(([, said]) => said.test(text))
    if (refused.length) return post(Object.fromEntries(Object.entries(sent).filter(([k]) => !refused.some(([key]) => key === k))))
    return new Response(text, { status: answer.status, headers: answer.headers })
  }

  /** Answers one chat request, telling `note` which link is answering for the log line. */
  async function chat(req: IncomingMessage, res: ServerResponse, note: (via: string) => void) {
    const raw = await readBody(req)
    if (!raw) return error(res, 413, 'The request is larger than 50 MB.')
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw.toString('utf8'))
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    } catch {
      return error(res, 400, 'The body is not a JSON object.')
    }
    // An app that leaves stops the model too, rather than leaving it generating.
    const stop = new AbortController()
    res.once('close', () => stop.abort())
    const failed: string[] = []
    for (const [index, entry] of chain.entries()) {
      // No one is waiting: the next link is not started, let alone asked.
      if (stop.signal.aborted) return
      const name = linkName(entry, index)
      const o: LinkOptions = (await d.options?.(entry).catch(() => ({}))) ?? {}
      const r = await d.route(entry, o.think)
      if (!r) {
        failed.push(`${name}: ${await d.why(entry)}`)
        continue
      }
      note(`${r.backend} · ${r.model}`)
      let answer: Response
      try {
        answer = await send(r, body, stop.signal, o)
      } catch {
        if (stop.signal.aborted) return
        failed.push(`${name}: could not be reached`)
        d.forget()
        continue
      }
      if (answer.status === 429 || answer.status >= 500) {
        // Said in words, with the server's own (MOD-43).
        const text = await answer.text().catch(() => '')
        const t = troubleIn(new CallError('', troubleOf(answer.status, text), detailOf(answer.status, text), answer.status))
        failed.push(`${name}: ${t.words} (${t.detail})`)
        continue
      }
      res.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' })
      if (!answer.body) res.end()
      // Streamed as it arrives, so an app's streaming works unchanged. A link
      // that drops mid-answer ends this response, never the server.
      else pipeline(Readable.fromWeb(answer.body as WebStream), res).catch(() => res.destroy())
      return
    }
    // Nothing answered: look afresh next time, since a server may be back by then.
    d.forget()
    note('no model')
    error(res, 503, `No model in navi's chain answered: ${failed.join('; ')}.`, 'service_unavailable')
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now()
    // The query is left out: it is the one place a client might put a key (SRV-6).
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '')
    // PSH-10: an answer's key is as good as a yes while it waits, so it is not logged.
    const shown = path.startsWith('/answer/') ? path.replace(/[^/]+$/, '…') : path
    let via: string | undefined
    // Logged once the answer is through, so a stream's time is all of it (SRV-6).
    res.once('close', () =>
      d.log(`${req.method} ${shown || '/'} → ${via ? `${via} · ` : ''}${res.writableFinished ? res.statusCode : 'cut off'} · ${Date.now() - started} ms`),
    )
    try {
      const j = o.jobs
      // JOB-10: the phone's page holds no secret; the token stays in its fragment.
      if (j && req.method === 'GET' && !path) {
        via = 'page'
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PHONE_PAGE)
      }
      // PSH-8: a notification's Yes or No, by the key of the approval it asks about.
      if (j && req.method === 'POST' && path.startsWith('/answer/')) {
        via = 'answer by key'
        const [, , id = '', key = ''] = path.split('/')
        const said = (await readBody(req))?.toString('utf8').trim().toLowerCase()
        if (said !== 'yes' && said !== 'no') return error(res, 400, 'Answer with the body yes or no.')
        if (!j.jobs.answerByKey(id, key, said === 'yes')) return error(res, 403, 'That question is no longer waiting, or the key is not its own.', 'permission_error')
        return json(res, 200, { answered: said })
      }
      // JOB-8, JOB-11: the token, from anywhere, the page's Origin included.
      if (j && (path === '/jobs' || path.startsWith('/jobs/'))) {
        if (!bearer(req, j.token)) {
          via = 'refused: no token'
          return error(res, 401, 'Jobs need the token in ~/.neoai/serve-token, as Authorization: Bearer <token>.', 'authentication_error')
        }
        return await jobsRoute(req, res, path, j)
      }
      // MEM-12: behind the same token.
      if (j && (path === '/memory' || path.startsWith('/memory/'))) {
        if (!bearer(req, j.token)) {
          via = 'refused: no token'
          return error(res, 401, 'Memory needs the token in ~/.neoai/serve-token, as Authorization: Bearer <token>.', 'authentication_error')
        }
        return await memoryRoute(req, res, path, j)
      }
      // JOB-40: behind the same token.
      if (j && (path === '/settings' || path.startsWith('/settings/'))) {
        if (!bearer(req, j.token)) {
          via = 'refused: no token'
          return error(res, 401, 'Settings need the token in ~/.neoai/serve-token, as Authorization: Bearer <token>.', 'authentication_error')
        }
        return await settingsRoute(req, res, path, j)
      }
      // SCH-7: behind the same token.
      if (j?.schedules && (path === '/schedules' || path.startsWith('/schedules/'))) {
        if (!bearer(req, j.token)) {
          via = 'refused: no token'
          return error(res, 401, 'Schedules need the token in ~/.neoai/serve-token, as Authorization: Bearer <token>.', 'authentication_error')
        }
        return await schedulesRoute(req, res, path, j, j.schedules)
      }
      // JOB-10: on the tailnet the model endpoints need the token too.
      if (o.remote && !(j && bearer(req, j.token))) {
        via = 'refused: no token'
        return error(res, 401, 'From another device, navi serve needs the token in ~/.neoai/serve-token as the API key.', 'authentication_error')
      }
    } catch (e) {
      if (!res.headersSent) return error(res, 500, e instanceof Error ? e.message : String(e), 'server_error')
      return void res.destroy()
    }
    // SRV-5: a browser page carries an Origin; local apps do not.
    if (req.headers.origin) {
      via = `refused: sent from a web page (${req.headers.origin})`
      return error(res, 403, 'Requests from web pages are refused.', 'permission_error')
    }
    try {
      if (req.method === 'GET' && path === '/v1/models')
        return res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ object: 'list', data: [{ id: 'navi', object: 'model', created: 0, owned_by: 'navi' }] }))
      if (req.method === 'POST' && path === '/v1/chat/completions') return await chat(req, res, (v) => (via = v))
      error(res, 404, `navi serves GET /v1/models and POST /v1/chat/completions${o.jobs ? ', and jobs under /jobs' : ''}, not ${req.method} ${path || '/'}.`)
    } catch (e) {
      if (!res.headersSent) error(res, 500, e instanceof Error ? e.message : String(e), 'server_error')
      else res.destroy()
    }
  }
}

/**
 * Starts listening on loopback (SRV-1), and on each tailnet address given
 * (JOB-10); resolves once all are.
 */
export async function listen(chain: Entry[], d: ServeDeps, port = DEFAULT_PORT, o: { jobs?: JobsOptions; tailnet?: string[] } = {}): Promise<Server[]> {
  const on = (host: string, remote: boolean) => {
    const server = createServer(serveHandler(chain, d, { jobs: o.jobs, remote }))
    return new Promise<Server>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => resolve(server))
    })
  }
  const servers = [await on('127.0.0.1', false)]
  try {
    for (const host of o.tailnet ?? []) servers.push(await on(host, true))
  } catch (e) {
    for (const s of servers) s.close()
    throw e
  }
  return servers
}

const run = promisify(execFile)
export const AGENT = 'dev.neoai.navi-serve'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The LaunchAgent that keeps `navi serve` running (SRV-8). */
export function agentPlist(navi: string, port: number, log: string, path: string, tailnet = false): string {
  const args = [navi, 'serve', '--port', String(port), ...(tailnet ? ['--tailnet'] : [])].map((a) => `    <string>${xml(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`
}

/** The first `navi` on PATH, which is what the agent runs. */
async function naviOnPath(path = process.env.PATH ?? ''): Promise<string | null> {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const file = join(dir, 'navi')
    const runnable = await access(file, constants.X_OK).then(() => stat(file).then((s) => s.isFile()), () => false)
    if (runnable) return file
  }
  return null
}

const agentFile = (home: string) => join(home, 'Library', 'LaunchAgents', `${AGENT}.plist`)

/** Provider keys this shell has in its environment but config.json lacks: launchd will not see them (SRV-8). */
export function keysOnlyInEnv(config: Record<string, any>, env: Record<string, string | undefined> = process.env): string[] {
  return PROVIDERS.filter((p) => env[p.env] && !config.keys?.[p.id]).map((p) => p.env)
}

/** Installs or replaces the LaunchAgent and starts it; returns the log's path (SRV-8). */
export async function installAgent(home: string, port: number, tailnet = false): Promise<{ log: string; unsaved: string[] } | { problem: string }> {
  if (process.platform !== 'darwin') return { problem: 'Keeping navi serve running is only set up on macOS.' }
  const navi = await naviOnPath()
  if (!navi) return { problem: 'navi is not on PATH; install it first (neonavi/install.sh).' }
  const log = join(home, 'Library', 'Logs', 'navi-serve.log')
  const file = agentFile(home)
  await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true })
  await mkdir(join(home, 'Library', 'Logs'), { recursive: true })
  const domain = `gui/${process.getuid?.()}`
  // Replacing: the old one is stopped first, or bootstrap refuses.
  await run('launchctl', ['bootout', `${domain}/${AGENT}`]).catch(() => {})
  await writeFile(file, agentPlist(navi, port, log, process.env.PATH ?? '/usr/bin:/bin', tailnet))
  // launchd may still be letting go of the old one; a second try a moment later usually takes.
  const start = () => run('launchctl', ['bootstrap', domain, file])
  try {
    await start().catch(() => new Promise((r) => setTimeout(r, 1000)).then(start))
  } catch (e) {
    await rm(file, { force: true })
    const why = String((e as { stderr?: string }).stderr || (e as Error).message).trim()
    return { problem: `launchd would not start navi serve: ${why}` }
  }
  return { log, unsaved: keysOnlyInEnv(await readConfig()) }
}

/** Stops and removes the LaunchAgent; false when there was none (SRV-8). */
export async function uninstallAgent(home: string): Promise<boolean> {
  const file = agentFile(home)
  const had = await access(file).then(() => true, () => false)
  await run('launchctl', ['bootout', `gui/${process.getuid?.()}/${AGENT}`]).catch(() => {})
  await rm(file, { force: true })
  return had
}
