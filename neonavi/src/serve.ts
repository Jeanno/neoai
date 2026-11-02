import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { access, constants, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { ReadableStream as WebStream } from 'node:stream/web'
import { diagnose, PROVIDERS, readConfig, reset, route, type Route } from 'neorouter'
import { optionsFor, type Entry } from './spec.ts'
import { timingSafeEqual } from 'node:crypto'
import { stat as statPath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Jobs } from './jobs.ts'
import { checkWhen, type Schedules } from './schedules.ts'
import { PHONE_PAGE } from './phone.ts'
import { jobChanges, undo, undoneReport } from './undo.ts'
import { homedir } from 'node:os'

/** What the server needs from the world; the real ones by default, fakes in tests. */
export interface ServeDeps {
  route: (entry: Entry) => Promise<Route | null>
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
    route: (entry) => route(optionsFor(entry)),
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

/** One link in words, for logs and errors: "primary (Darkbloom)". */
function linkName(entry: Entry, index: number): string {
  const slot = ['primary', 'fallback'][index] ?? `link ${index + 1}`
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
  /** Where undo keeps jobs' changes (UND-10); the user's home when left out. */
  home?: string
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

/** The schedules API (SCH-7); the token is already checked. */
async function schedulesRoute(req: IncomingMessage, res: ServerResponse, path: string, o: JobsOptions, schedules: Schedules) {
  const parts = path.split('/').slice(2)
  if (req.method === 'GET' && !parts.length) return json(res, 200, { schedules: schedules.list() })
  if (req.method !== 'POST') return error(res, 404, `Schedules answer GET /schedules, POST /schedules and POST /schedules/<id>/run or delete, not ${req.method} ${path}.`)
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
  if (parts[1] === 'delete' && parts.length === 2) {
    await schedules.remove(parts[0])
    return json(res, 200, { deleted: parts[0] })
  }
  error(res, 404, `Schedules answer GET /schedules, POST /schedules and POST /schedules/<id>/run or delete, not ${req.method} ${path}.`)
}

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
    return json(res, 201, jobs.create(body.prompt.trim(), directory))
  }
  const job = parts[0] ? jobs.get(parts[0]) : undefined
  if (!job) return error(res, 404, `There is no job ${parts[0] ?? ''}.`)
  const home = o.home ?? homedir()
  if (req.method === 'GET' && parts.length === 1) return json(res, 200, { ...job, changes: await jobChanges(home, job.directory, job.id) })
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'undo') {
    // UND-11: not while it may still be writing.
    if (job.status === 'running' || job.status === 'waiting') return error(res, 400, 'The job is still working; stop it or wait for it first.')
    const got = await undo(home, job.directory, job.id)
    if (!got) return error(res, 400, 'Nothing of this job is left to undo.')
    const report = undoneReport(got)
    await jobs.note(job.id, ['↶ undone:', ...report.lines.map((l) => `  ${l}`)])
    return json(res, 200, report)
  }
  if (req.method === 'POST' && parts.length === 2) {
    const body = await jsonBody(req)
    if (typeof body === 'string') return error(res, 400, body)
    if (parts[1] === 'answer') {
      if (typeof body.yes !== 'boolean') return error(res, 400, 'Answer with { "yes": true } or { "yes": false }.')
      return jobs.answer(job.id, body.yes) ? json(res, 200, jobs.get(job.id)) : error(res, 400, 'The job is not waiting on an approval.')
    }
    if (parts[1] === 'reply') {
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) return error(res, 400, 'Give the follow-up a prompt.')
      return jobs.reply(job.id, body.prompt.trim()) ? json(res, 200, jobs.get(job.id)) : error(res, 400, 'The job is still working; wait for it, or stop it.')
    }
    if (parts[1] === 'stop') return jobs.stop(job.id) ? json(res, 200, jobs.get(job.id)) : error(res, 400, 'The job is not running.')
  }
  error(res, 404, `Jobs answer GET /jobs, POST /jobs, GET /jobs/<id> and POST /jobs/<id>/answer, reply, stop or undo, not ${req.method} ${path}.`)
}

/**
 * The request handler for SRV-2 to SRV-7, over the chain navi resolves, and
 * jobs when given (JOB-7). `remote` is a listener on the tailnet (JOB-10),
 * where every request needs the token.
 */
export function serveHandler(chain: Entry[], d: ServeDeps, o: { jobs?: JobsOptions; remote?: boolean } = {}) {
  /** Posts to one link; a 400 over the reasoning hint navi added is asked once more without it, as navi does. */
  async function send(r: Route, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const sent: Record<string, unknown> = { ...r.extra, ...body, model: r.model }
    const answer = await d.fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(sent), signal })
    if (answer.status !== 400 || !r.extra.reasoning_effort || 'reasoning_effort' in body) return answer
    const text = await answer.text()
    if (/reasoning/i.test(text)) {
      const { reasoning_effort: _, ...rest } = sent
      return d.fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(rest), signal })
    }
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
      const r = await d.route(entry)
      if (!r) {
        failed.push(`${name}: ${await d.why(entry)}`)
        continue
      }
      note(`${r.backend} · ${r.model}`)
      let answer: Response
      try {
        answer = await send(r, body, stop.signal)
      } catch {
        if (stop.signal.aborted) return
        failed.push(`${name}: could not be reached`)
        d.forget()
        continue
      }
      if (answer.status === 429 || answer.status >= 500) {
        failed.push(`${name}: answered ${answer.status}`)
        await answer.body?.cancel()
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
    let via: string | undefined
    // Logged once the answer is through, so a stream's time is all of it (SRV-6).
    res.once('close', () =>
      d.log(`${req.method} ${path || '/'} → ${via ? `${via} · ` : ''}${res.writableFinished ? res.statusCode : 'cut off'} · ${Date.now() - started} ms`),
    )
    try {
      const j = o.jobs
      // JOB-10: the phone's page holds no secret; the token stays in its fragment.
      if (j && req.method === 'GET' && !path) {
        via = 'page'
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PHONE_PAGE)
      }
      // JOB-8, JOB-11: the token, from anywhere, the page's Origin included.
      if (j && (path === '/jobs' || path.startsWith('/jobs/'))) {
        if (!bearer(req, j.token)) {
          via = 'refused: no token'
          return error(res, 401, 'Jobs need the token in ~/.neoai/serve-token, as Authorization: Bearer <token>.', 'authentication_error')
        }
        return await jobsRoute(req, res, path, j)
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
