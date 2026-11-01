import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { ModelMessage } from 'ai'
import type { Answer, HarnessOptions, Session } from './harness.ts'

/**
 * Work navi does in the background, inside navi serve (jobs.md): each job a
 * harness session whose approvals wait in the job until answered, from the
 * terminal or a phone.
 */

export type Status = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'interrupted'

/** What a job waits on (JOB-4). */
export interface Pending {
  command: string
  /** The page a browser action is on. */
  url?: string
  /** A file change's diff. */
  diff?: string
}

export interface Job {
  id: string
  prompt: string
  directory: string
  created: string
  updated: string
  status: Status
  /** The model that answered last. */
  model?: string
  answer?: string
  error?: string
  /** One line per thing done (JOB-2). */
  log: string[]
  pending?: Pending
  /** The conversation, to follow up (JOB-3, JOB-6). */
  history: ModelMessage[]
  /** The schedule that started it (SCH-2). */
  schedule?: string
  /** Started by a watch, which may answer NOTHING NEW (SCH-9). */
  watch?: true
  /** A watch's run that found nothing new, so said nothing (SCH-10). */
  unchanged?: true
}

/** How a job is started beyond its prompt and directory. */
export interface StartOptions {
  schedule?: string
  /** What the model is sent in place of the prompt (SCH-11). */
  send?: string
  watch?: boolean
}

/** A watch's answer when nothing changed (SCH-10). */
export const NOTHING_NEW = 'NOTHING NEW'
export const nothingNew = (answer: string | undefined) => /^\W*nothing new\W*$/i.test(answer ?? '')

/** A job as listed: no conversation or log (JOB-7). */
export type Listed = Omit<Job, 'history' | 'log'>

export interface JobDeps {
  home: string
  /** A session to run a job's turn in; throws when no model answers. */
  start: (o: { directory: string; history: ModelMessage[]; approve: NonNullable<HarnessOptions['approve']> }) => Promise<{ session: Session; model: string }>
  /** A notification (JOB-5), for the desktop and a phone (PSH-1); `urgent` when it waits on you. */
  notify: (title: string, text: string, job: string, urgent?: boolean) => void
}

export interface Jobs {
  list(): Listed[]
  get(id: string): Job | undefined
  create(prompt: string, directory: string, o?: StartOptions): Job
  /** False when the job is not waiting. */
  answer(id: string, yes: boolean): boolean
  /** False when the job is running or waiting (JOB-3). */
  reply(id: string, prompt: string): boolean
  stop(id: string): boolean
  /** Settles once no job is running: for tests and shutdown. */
  idle(): Promise<void>
}

const KEPT = 100
export const jobsDir = (home: string) => join(home, '.neoai', 'jobs')

/** A job's start, for notifications and lists. */
export const titleOf = (prompt: string) => (prompt.length > 60 ? `${prompt.slice(0, 57).trimEnd()}…` : prompt).replace(/\s+/g, ' ')

const brief = (input: unknown) => {
  const s = typeof input === 'string' ? input : JSON.stringify(input)
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Jobs kept on disk, and those that were running when navi serve stopped marked so (JOB-6). */
export async function loadJobs(home: string): Promise<Job[]> {
  const dir = jobsDir(home)
  const names = await readdir(dir).catch(() => [] as string[])
  const out: Job[] = []
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const job = JSON.parse(await readFile(join(dir, name), 'utf8')) as Job
      if (typeof job.id !== 'string' || typeof job.prompt !== 'string') continue
      if (job.status === 'running' || job.status === 'waiting') {
        job.status = 'interrupted'
        delete job.pending
      }
      out.push(job)
    } catch {
      // A file cut short, or not a job.
    }
  }
  return out.sort((a, b) => b.created.localeCompare(a.created))
}

export async function makeJobs(d: JobDeps): Promise<Jobs> {
  const dir = jobsDir(d.home)
  const jobs = new Map<string, Job>()
  for (const job of await loadJobs(d.home)) jobs.set(job.id, job)
  const answers = new Map<string, (yes: boolean) => void>()
  const stops = new Map<string, AbortController>()
  const running = new Set<Promise<void>>()

  // Written whole and renamed into place, so a crash leaves the old one (JOB-6).
  let writes = Promise.resolve()
  const save = (job: Job) => {
    job.updated = new Date().toISOString()
    const copy = JSON.stringify(job)
    writes = writes.then(async () => {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const file = join(dir, `${job.id}.json`)
        await writeFile(`${file}.tmp`, copy, { mode: 0o600 })
        await rename(`${file}.tmp`, file)
        await chmod(file, 0o600)
      } catch {
        // Kept in memory; the next change tries again.
      }
    })
    return writes
  }

  /** Past the 100 most recent, the oldest that are not busy go (JOB-6). */
  const prune = async () => {
    const all = [...jobs.values()].sort((a, b) => b.created.localeCompare(a.created))
    for (const old of all.slice(KEPT)) {
      if (old.status === 'running' || old.status === 'waiting') continue
      jobs.delete(old.id)
      await rm(join(dir, `${old.id}.json`), { force: true }).catch(() => {})
    }
  }

  async function run(job: Job, prompt: string) {
    const stop = new AbortController()
    stops.set(job.id, stop)
    job.status = 'running'
    delete job.answer
    delete job.error
    delete job.unchanged
    await save(job)
    const approve = (command: string, o: Parameters<NonNullable<HarnessOptions['approve']>>[1]): Promise<Answer> =>
      new Promise<boolean>((resolve) => {
        job.pending = { command, ...(o.action && { url: o.action.url }), ...(o.change && { diff: o.change.diff }) }
        job.status = 'waiting'
        void save(job)
        d.notify('navi is waiting for you', `${titleOf(job.prompt)}: ${command}`, job.id, true)
        const settle = (yes: boolean) => {
          answers.delete(job.id)
          o.signal.removeEventListener('abort', no)
          delete job.pending
          if (job.status === 'waiting') job.status = 'running'
          job.log.push(`${yes ? '✓' : '✗'} ${command}`)
          void save(job)
          resolve(yes)
        }
        const no = () => settle(false)
        answers.set(job.id, settle)
        o.signal.addEventListener('abort', no, { once: true })
      })
    try {
      const { session, model } = await d.start({ directory: job.directory, history: job.history, approve })
      job.model = model
      const errors: string[] = []
      for await (const e of session.turn(prompt, { signal: stop.signal })) {
        if (e.type === 'tool-call') job.log.push(`· ${e.name}(${brief(e.input)})`)
        else if (e.type === 'tool-result' && e.error) job.log.push(`  failed: ${brief(e.output)}`)
        else if (e.type === 'auto-approved') job.log.push(`· ${e.allowed ? 'allowed' : 'auto-approved'}: ${e.command}`)
        else if (e.type === 'compacted') job.log.push(`· compacted ${e.messages} messages`)
        else if (e.type === 'escalated') {
          job.model = e.to
          job.log.push(`· escalated to ${e.to}${e.local ? '' : ' (REMOTE)'}: ${e.reason}`)
        } else if (e.type === 'error') {
          errors.push(message(e.error))
          job.log.push(`error: ${message(e.error)}`)
        } else if (e.type === 'done') {
          job.history = e.history
          job.answer = e.text
          job.status = e.stopped ? 'stopped' : e.empty && errors.length ? 'failed' : 'done'
          if (job.status === 'failed') job.error = errors[0]
        } else continue
        void save(job)
      }
    } catch (e) {
      job.status = 'failed'
      job.error = message(e)
    } finally {
      stops.delete(job.id)
      delete job.pending
    }
    // SCH-10: a watch that found nothing says nothing.
    if (job.watch && job.status === 'done' && nothingNew(job.answer)) job.unchanged = true
    await save(job)
    const word = { done: 'is done', failed: 'failed', stopped: 'was stopped' }[job.status as 'done' | 'failed' | 'stopped']
    if (word && !job.unchanged) d.notify(`navi ${word}`, titleOf(job.prompt), job.id)
    await prune()
  }

  const begin = (job: Job, prompt: string) => {
    const p = run(job, prompt).catch(() => {})
    running.add(p)
    void p.finally(() => running.delete(p))
  }

  const listed = ({ history: _h, log: _l, ...rest }: Job): Listed => rest

  return {
    list: () => [...jobs.values()].sort((a, b) => b.created.localeCompare(a.created)).map(listed),
    get: (id) => jobs.get(id),
    create(prompt, directory, o = {}) {
      const now = new Date().toISOString()
      const job: Job = {
        id: randomBytes(4).toString('hex'),
        prompt,
        directory,
        created: now,
        updated: now,
        status: 'running',
        log: [],
        history: [],
        ...(o.schedule && { schedule: o.schedule }),
        ...(o.watch && { watch: true as const }),
      }
      jobs.set(job.id, job)
      begin(job, o.send ?? prompt)
      return job
    },
    answer(id, yes) {
      const settle = answers.get(id)
      if (!settle) return false
      settle(yes)
      return true
    },
    reply(id, prompt) {
      const job = jobs.get(id)
      if (!job || job.status === 'running' || job.status === 'waiting') return false
      job.log.push(`> ${prompt}`)
      begin(job, prompt)
      return true
    },
    stop(id) {
      const stop = stops.get(id)
      if (!stop) return false
      stop.abort()
      return true
    },
    async idle() {
      while (running.size) await Promise.all([...running])
      await writes
    },
  }
}

/** The token every jobs request needs (JOB-8), made the first time. */
export async function serveToken(home: string): Promise<string> {
  const file = join(home, '.neoai', 'serve-token')
  const had = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f]{64}$/.test(had)) return had
  const token = randomBytes(32).toString('hex')
  await mkdir(join(home, '.neoai'), { recursive: true, mode: 0o700 })
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return token
}

/** This computer's Tailscale addresses: IPv4 in 100.64.0.0/10 (JOB-10). */
export function tailnetAddresses(interfaces = networkInterfaces()): string[] {
  const out: string[] = []
  for (const list of Object.values(interfaces))
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const [x, y] = a.address.split('.').map(Number)
      if (x === 100 && y >= 64 && y <= 127) out.push(a.address)
    }
  return [...new Set(out)]
}
