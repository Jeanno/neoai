import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import type { ReadableStream as WebStream } from 'node:stream/web'
import { diagnose, reset, route, type Route } from 'neorouter'
import { optionsFor, type Entry } from './spec.ts'

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

/** The request handler for SRV-2 to SRV-7, over the chain navi resolves. */
export function serveHandler(chain: Entry[], d: ServeDeps) {
  async function chat(req: IncomingMessage, res: ServerResponse, started: number) {
    const raw = await readBody(req)
    if (!raw) return error(res, 413, 'The request is larger than 50 MB.')
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw.toString('utf8'))
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    } catch {
      return error(res, 400, 'The body is not a JSON object.')
    }
    const failed: string[] = []
    for (const [index, entry] of chain.entries()) {
      const name = linkName(entry, index)
      const r = await d.route(entry)
      if (!r) {
        failed.push(`${name}: ${await d.why(entry)}`)
        continue
      }
      // The request's own fields win; navi only fills in what it would add (SRV-3).
      const sent = { ...r.extra, ...body, model: r.model }
      let answer: Response
      try {
        answer = await d.fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(sent) })
      } catch {
        failed.push(`${name}: could not be reached`)
        d.forget()
        continue
      }
      if (answer.status === 429 || answer.status >= 500) {
        failed.push(`${name}: answered ${answer.status}`)
        await answer.body?.cancel()
        continue
      }
      // Logged once the answer is through, so a stream's time is all of it (SRV-6).
      res.once('close', () => d.log(`${req.method} ${req.url} → ${r.backend} · ${r.model} · ${answer.status} · ${Date.now() - started} ms`))
      res.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' })
      if (!answer.body) return res.end()
      // Streamed as it arrives, so an app's streaming works unchanged.
      Readable.fromWeb(answer.body as WebStream).pipe(res)
      return
    }
    // Nothing answered: look afresh next time, since a server may be back by then.
    d.forget()
    d.log(`${req.method} ${req.url} → no model · 503 · ${Date.now() - started} ms`)
    error(res, 503, `No model in navi's chain answered: ${failed.join('; ')}.`, 'service_unavailable')
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now()
    // SRV-5: a browser page carries an Origin; local apps do not.
    if (req.headers.origin) {
      d.log(`${req.method} ${req.url} → refused: sent from a web page (${req.headers.origin})`)
      return error(res, 403, 'Requests from web pages are refused.', 'permission_error')
    }
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '')
    try {
      if (req.method === 'GET' && path === '/v1/models')
        return res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ object: 'list', data: [{ id: 'navi', object: 'model', created: 0, owned_by: 'navi' }] }))
      if (req.method === 'POST' && path === '/v1/chat/completions') return await chat(req, res, started)
      error(res, 404, `navi serves GET /v1/models and POST /v1/chat/completions, not ${req.method} ${path || '/'}.`)
    } catch (e) {
      if (!res.headersSent) error(res, 500, e instanceof Error ? e.message : String(e), 'server_error')
      else res.destroy()
    }
  }
}

/** Starts listening on loopback (SRV-1); resolves once it is. */
export function listen(chain: Entry[], d: ServeDeps, port = DEFAULT_PORT): Promise<Server> {
  const server = createServer(serveHandler(chain, d))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

const run = promisify(execFile)
export const AGENT = 'dev.neoai.navi-serve'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The LaunchAgent that keeps `navi serve` running (SRV-8). */
export function agentPlist(navi: string, port: number, log: string, path: string): string {
  const args = [navi, 'serve', '--port', String(port)].map((a) => `    <string>${xml(a)}</string>`).join('\n')
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
    if (await access(file).then(() => true, () => false)) return file
  }
  return null
}

const agentFile = (home: string) => join(home, 'Library', 'LaunchAgents', `${AGENT}.plist`)

/** Installs or replaces the LaunchAgent and starts it; returns the log's path (SRV-8). */
export async function installAgent(home: string, port: number): Promise<{ log: string } | { problem: string }> {
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
  await writeFile(file, agentPlist(navi, port, log, process.env.PATH ?? '/usr/bin:/bin'))
  await run('launchctl', ['bootstrap', domain, file])
  return { log }
}

/** Stops and removes the LaunchAgent; false when there was none (SRV-8). */
export async function uninstallAgent(home: string): Promise<boolean> {
  const file = agentFile(home)
  const had = await access(file).then(() => true, () => false)
  await run('launchctl', ['bootout', `gui/${process.getuid?.()}/${AGENT}`]).catch(() => {})
  await rm(file, { force: true })
  return had
}
