import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * navi serve's jobs, from Raycast (RAY-15 to RAY-17): the same API the
 * phone page and `navi jobs` use, on this computer only.
 */

export const PORT = 8484

export type Status = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'interrupted'

export interface JobRow {
  id: string
  prompt: string
  directory: string
  created: string
  updated?: string
  status: Status
  model?: string
  answer?: string
  error?: string
  pending?: { command: string; url?: string; diff?: string }
  unchanged?: true
  cut?: true
}

/** No navi serve to ask: not running, or never run, so no token (RAY-17). */
export class NotServing extends Error {
  constructor() {
    super('navi serve is not running')
  }
}

export function jobsClient(o: { home?: string; port?: number; fetch?: typeof fetch } = {}) {
  const home = o.home ?? homedir()
  const port = o.port ?? PORT
  const f = o.fetch ?? fetch
  const call = async (path: string, body?: unknown): Promise<unknown> => {
    // Read, never made: making one is navi serve's to do (RAY-17).
    const token = (await readFile(join(home, '.neoai', 'serve-token'), 'utf8').catch(() => '')).trim()
    if (!token) throw new NotServing()
    let r: Response
    try {
      r = await f(`http://127.0.0.1:${port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new NotServing()
    }
    const data: unknown = await r.json().catch(() => ({}))
    // RAY-16: said as navi serve says it.
    if (!r.ok) throw new Error((data as { error?: { message?: string } })?.error?.message ?? `navi serve answered ${r.status}`)
    return data
  }
  const post = (id: string, what: string, body: unknown = {}) => call(`/jobs/${encodeURIComponent(id)}/${what}`, body)
  return {
    list: async () => ((await call('/jobs')) as { jobs: JobRow[] }).jobs,
    /** In navi serve's first folder, as the phone page starts one (JOB-8). */
    start: async (prompt: string) => (await call('/jobs', { prompt })) as JobRow,
    answer: (id: string, yes: boolean) => post(id, 'answer', { yes }),
    retry: (id: string) => post(id, 'retry'),
    stop: (id: string) => post(id, 'stop'),
    reply: (id: string, prompt: string) => post(id, 'reply', { prompt }),
    remove: (id: string) => post(id, 'delete'),
  }
}

/** Waiting on you, then working, then the rest; each newest first (RAY-15). */
export function sections(jobs: JobRow[]): { title: string; jobs: JobRow[] }[] {
  const newest = (a: JobRow, b: JobRow) => b.created.localeCompare(a.created)
  const of = (keep: (s: Status) => boolean) => jobs.filter((j) => keep(j.status)).sort(newest)
  return [
    { title: 'Needs You', jobs: of((s) => s === 'waiting') },
    { title: 'Working', jobs: of((s) => s === 'running' || s === 'queued') },
    { title: 'Recent', jobs: of((s) => !['waiting', 'running', 'queued'].includes(s)) },
  ].filter((s) => s.jobs.length)
}

const WORDS: Record<Status, string> = {
  queued: 'Queued',
  running: 'Working',
  waiting: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
}

export const statusWord = (j: Pick<JobRow, 'status' | 'unchanged'>) => (j.unchanged ? 'Nothing new' : WORDS[j.status] ?? j.status)

/** What can be done with a job from the list (RAY-16). */
export function actionsFor(j: JobRow): { allow: boolean; copy: boolean; retry: boolean; stop: boolean; followUp: boolean; remove: boolean } {
  const working = j.status === 'queued' || j.status === 'running' || j.status === 'waiting'
  return {
    // RAY-18
    followUp: !working,
    remove: !working,
    allow: j.status === 'waiting' && !!j.pending,
    copy: !!j.answer,
    retry: j.status === 'failed' || j.status === 'interrupted',
    stop: working,
  }
}

/** A fence longer than any run of backticks in the text, so nothing in it closes the block. */
const fence = (text: string) => '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((m) => m.length + 1)))

/** The job beside the list, as Markdown (RAY-15). */
export function detailOf(j: JobRow): string {
  const parts = [`**${statusWord(j)}** · ${j.directory}${j.model ? ` · ${j.model}` : ''}`, '', quote(j.prompt)]
  if (j.pending) {
    const f = fence(j.pending.command)
    parts.push('', '### navi asks to', '', `${f}\n${j.pending.command}\n${f}`)
    if (j.pending.url) parts.push('', `on ${j.pending.url}`)
    if (j.pending.diff) {
      const d = fence(j.pending.diff)
      parts.push('', `${d}diff\n${j.pending.diff}\n${d}`)
    }
  }
  if (j.answer) parts.push('', '---', '', j.answer)
  if (j.error) parts.push('', `**Failed:** ${j.error}`)
  if (j.cut) parts.push('', '_Cut short: the answer reached the model’s token cap._')
  return parts.join('\n')
}

const quote = (text: string) => text.split('\n').map((l) => `> ${l}`).join('\n')
