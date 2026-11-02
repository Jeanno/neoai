import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { ModelMessage } from 'ai'
import { CUT_NOTE, type Answer, type HarnessOptions, type Session } from './harness.ts'
import type { Attachment } from './attach.ts'
import { glance, glancePage } from './diff.ts'

/**
 * Work navi does in the background, inside navi serve (jobs.md): each job a
 * harness session whose approvals wait in the job until answered, from the
 * terminal or a phone.
 */

export type Status = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'interrupted'

/** Still working: not to be followed up, undone or run again by a schedule (JOB-3, JOB-22). */
export const working = (s: string | undefined) => s === 'queued' || s === 'running' || s === 'waiting'

/** How many jobs run at once (JOB-21). */
export const AT_ONCE = 2

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
  /** The failed job this one tried again (SCH-28). */
  retryOf?: string
  /** A watch's run that found nothing new, so said nothing (SCH-10). */
  unchanged?: true
  /** The names of the files it was given (JOB-15). */
  files?: string[]
  /** The latest follow-up, shown while it runs (JOB-27). */
  asked?: string
  /** Its last answer reached the token cap (HAR-11), so the phone offers Go on (JOB-35). */
  cut?: true
}

/** How a job is started beyond its prompt and directory. */
export interface StartOptions {
  schedule?: string
  /** What the model is sent in place of the prompt (SCH-11). */
  send?: string
  watch?: boolean
  /** The failed job this one tries again (SCH-28). */
  retry?: string
  /** Sent with the first turn (JOB-14). */
  attachments?: Attachment[]
}

/** A watch's answer when nothing changed (SCH-10). */
export const NOTHING_NEW = 'NOTHING NEW'
export const nothingNew = (answer: string | undefined) => /^\W*nothing new\W*$/i.test(answer ?? '')

/** A job as listed: no conversation or log (JOB-7). */
export type Listed = Omit<Job, 'history' | 'log' | 'asked'>

export interface JobDeps {
  home: string
  /** A session to run a job's turn in; throws when no model answers. */
  /** `answered`: the model whose answer the job last gave, and when, for the ledger (LED-7). */
  start: (o: {
    job: string
    directory: string
    history: ModelMessage[]
    approve: NonNullable<HarnessOptions['approve']>
    answered?: { model: string; at: number }
  }) => Promise<{ session: Session; model: string }>
  /**
   * A notification (JOB-5), for the desktop and a phone (PSH-1); `urgent` when
   * it waits on you, with the key that answers that approval (PSH-8).
   */
  notify: (title: string, text: string, job: string, urgent?: boolean, key?: string) => void
  /** At most this many run at once, the rest queued (JOB-21); AT_ONCE unless given. */
  atOnce?: number
}

export interface Jobs {
  list(): Listed[]
  get(id: string): Job | undefined
  create(prompt: string, directory: string, o?: StartOptions): Job
  /** False when the job is not waiting. */
  answer(id: string, yes: boolean): boolean
  /** Answers with the waiting approval's key instead of the token (PSH-8); false for any other key. */
  answerByKey(id: string, key: string, yes: boolean): boolean
  /** False when the job is running or waiting (JOB-3). */
  reply(id: string, prompt: string, attachments?: Attachment[]): boolean
  stop(id: string): boolean
  /** Adds lines to a job's log (UND-12); false when there is no such job. */
  note(id: string, lines: string[]): Promise<boolean>
  /** Deletes a job that is not working (JOB-24); false when there is none, or it is. */
  remove(id: string): Promise<boolean>
  /** Deletes every job that is not working (JOB-25); how many. */
  clear(): Promise<number>
  /** Settles once no job is running: for tests and shutdown. */
  idle(): Promise<void>
}

const KEPT = 100
export const jobsDir = (home: string) => join(home, '.neoai', 'jobs')

/** Whether a job holds every one of the words, in its prompt, answer, error or status, any case (JOB-30). */
export function matches(job: Pick<Job, 'prompt' | 'status'> & { answer?: string; error?: string; asked?: string }, words: string): boolean {
  const hay = [job.prompt, job.asked, job.answer, job.error, job.status].filter(Boolean).join('\n').toLowerCase()
  return words.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

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
      if (working(job.status)) {
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
  // PSH-8: in memory only, one per waiting approval.
  const keys = new Map<string, string>()
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

  /** Gone from memory and disk, after any write of it still on its way. */
  const forget = (id: string) => {
    jobs.delete(id)
    writes = writes.then(() => rm(join(dir, `${id}.json`), { force: true }).catch(() => {}))
    return writes
  }

  /** Past the 100 most recent, the oldest that are not busy go (JOB-6). */
  const prune = async () => {
    const all = [...jobs.values()].sort((a, b) => b.created.localeCompare(a.created))
    for (const old of all.slice(KEPT)) if (!working(old.status)) await forget(old.id)
  }

  async function run(job: Job, prompt: string, attachments?: Attachment[], answered?: { model: string; at: number }) {
    const stop = new AbortController()
    stops.set(job.id, stop)
    job.status = 'running'
    delete job.answer
    delete job.error
    delete job.unchanged
    delete job.cut
    await save(job)
    const approve = (command: string, o: Parameters<NonNullable<HarnessOptions['approve']>>[1]): Promise<Answer> =>
      new Promise<boolean>((resolve) => {
        job.pending = { command, ...(o.action && { url: o.action.url }), ...(o.change && { diff: o.change.diff }) }
        job.status = 'waiting'
        void save(job)
        pump()
        const key = randomBytes(16).toString('hex')
        keys.set(job.id, key)
        // PSH-14, PSH-15: enough of what is asked to answer it from the notification.
        const shown = o.change ? glance(o.change) : o.action ? glancePage(o.action.url) : ''
        d.notify('navi is waiting for you', [`${titleOf(job.prompt)}: ${command}`, shown].filter(Boolean).join('\n'), job.id, true, key)
        const settle = (yes: boolean) => {
          answers.delete(job.id)
          keys.delete(job.id)
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
      const { session, model } = await d.start({ job: job.id, directory: job.directory, history: job.history, approve, ...(answered && { answered }) })
      job.model = model
      const errors: string[] = []
      for await (const e of session.turn(prompt, { signal: stop.signal, ...(attachments?.length && { attachments }) })) {
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
          if (e.cut) {
            job.log.push(`· ${CUT_NOTE}`)
            job.cut = true
          }
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

  // JOB-21: a place each for those running; one waiting on you holds none.
  const atOnce = Number.isInteger(d.atOnce) && d.atOnce! >= 1 ? d.atOnce! : AT_ONCE
  type Answered = { model: string; at: number }
  const queue: { job: Job; prompt: string; attachments?: Attachment[]; answered?: Answered }[] = []
  const busy = () => [...jobs.values()].filter((j) => j.status === 'running').length
  const pump = () => {
    while (queue.length && busy() < atOnce) {
      const next = queue.shift()!
      launch(next.job, next.prompt, next.attachments, next.answered)
    }
  }
  const launch = (job: Job, prompt: string, attachments?: Attachment[], answered?: Answered) => {
    // Running from here, so the next look at the queue counts it.
    job.status = 'running'
    const p = run(job, prompt, attachments, answered).catch(() => {})
    running.add(p)
    void p.finally(() => {
      running.delete(p)
      pump()
    })
  }
  const begin = (job: Job, prompt: string, attachments?: Attachment[]) => {
    // A follow-up to an answer can correct it (LED-7).
    const answered = job.status === 'done' && job.answer && job.model ? { model: job.model, at: Date.parse(job.updated) } : undefined
    if (busy() < atOnce && !queue.length) return launch(job, prompt, attachments, answered)
    job.status = 'queued'
    job.log.push(`· queued: ${queue.length ? `${queue.length} ahead of it` : 'next'}, as ${atOnce} run at once`)
    queue.push({ job, prompt, attachments, ...(answered && { answered }) })
    void save(job)
  }

  const listed = ({ history: _h, log: _l, asked: _a, ...rest }: Job): Listed => rest

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
        // Running once begun, unless it waits its turn (JOB-21).
        status: 'queued',
        log: [],
        history: [],
        ...(o.schedule && { schedule: o.schedule }),
        ...(o.watch && { watch: true as const }),
        ...(o.retry && { retryOf: o.retry, log: [`· trying again: job ${o.retry} failed`] }),
        ...(o.attachments?.length && { files: o.attachments.map((a) => a.name) }),
      }
      jobs.set(job.id, job)
      begin(job, o.send ?? prompt, o.attachments)
      return job
    },
    answer(id, yes) {
      const settle = answers.get(id)
      if (!settle) return false
      settle(yes)
      return true
    },
    answerByKey(id, key, yes) {
      const want = keys.get(id)
      if (!want || key.length !== want.length || !timingSafeEqual(Buffer.from(key), Buffer.from(want))) return false
      answers.get(id)?.(yes)
      return true
    },
    reply(id, prompt, attachments) {
      const job = jobs.get(id)
      if (!job || working(job.status)) return false
      // JOB-19: the follow-up's files join the job's.
      const names = attachments?.map((x) => x.name) ?? []
      job.log.push(`> ${prompt}${names.length ? ` (with ${names.join(', ')})` : ''}`)
      if (names.length) job.files = [...(job.files ?? []), ...names]
      job.asked = prompt
      begin(job, prompt, attachments)
      return true
    },
    stop(id) {
      // JOB-22: out of the queue, never having run.
      const at = queue.findIndex((q) => q.job.id === id)
      if (at >= 0) {
        const [{ job }] = queue.splice(at, 1)
        job.status = 'stopped'
        job.log.push('· stopped before it ran')
        void save(job)
        return true
      }
      const stop = stops.get(id)
      if (!stop) return false
      stop.abort()
      return true
    },
    async note(id, lines) {
      const job = jobs.get(id)
      if (!job) return false
      job.log.push(...lines)
      await save(job)
      return true
    },
    async remove(id) {
      const job = jobs.get(id)
      if (!job || working(job.status)) return false
      await forget(id)
      return true
    },
    async clear() {
      const done = [...jobs.values()].filter((j) => !working(j.status))
      for (const j of done) await forget(j.id)
      return done.length
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
