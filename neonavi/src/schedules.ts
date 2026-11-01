import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Jobs navi serve starts by itself (schedules.md): at a time of day, or
 * every so often.
 */

export interface Schedule {
  id: string
  prompt: string
  directory: string
  created: string
  /** `HH:MM`, local time (SCH-1). */
  at?: string
  /** The days an `at` schedule runs, 0 for Sunday; every day when absent. */
  days?: number[]
  /** Minutes between runs. */
  every?: number
  /** When it last ran, or was skipped (SCH-3, SCH-4). */
  last?: string
  /** The job its last run started. */
  job?: string
}

export type When = Pick<Schedule, 'at' | 'days' | 'every'>

export interface ScheduleDeps {
  home: string
  /** Starts a job; its id. */
  start: (prompt: string, directory: string, schedule: string) => string
  /** Whether a job is still running or waiting (SCH-3). */
  busy: (job: string) => boolean
}

export interface Schedules {
  /** Each schedule with when it next runs, soonest first. */
  list(now?: Date): (Schedule & { next: string })[]
  get(id: string): Schedule | undefined
  add(prompt: string, directory: string, when: When): Promise<Schedule>
  remove(id: string): Promise<boolean>
  /** Starts it now (SCH-7); the job's id. */
  run(id: string): Promise<string | undefined>
  /** Starts what is due (SCH-2 to SCH-4). */
  tick(now?: Date): Promise<void>
}

export const MIN_EVERY = 5
const LATE = 12 * 60 * 60 * 1000

export const schedulesFile = (home: string) => join(home, '.neoai', 'schedules.json')

/** What is wrong with a schedule's when, or nothing (SCH-1). */
export function checkWhen(w: When): string | undefined {
  if ((w.at === undefined) === (w.every === undefined)) return 'Say when: either at a time of day (HH:MM) or every so many minutes.'
  if (w.every !== undefined) {
    if (!Number.isInteger(w.every) || w.every < MIN_EVERY) return `every must be a whole number of minutes, ${MIN_EVERY} at the least.`
    if (w.days !== undefined) return 'days go with at, not every.'
    return
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(w.at ?? '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return `at must be a time of day as HH:MM, not ${w.at}.`
  if (w.days !== undefined && (!Array.isArray(w.days) || !w.days.length || w.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)))
    return 'days are numbers from 0 (Sunday) to 6.'
}

/** The first run after `after` (SCH-2). */
export function nextRun(s: When, after: Date): Date {
  if (s.every !== undefined) return new Date(after.getTime() + s.every * 60_000)
  const [h, m] = (s.at ?? '0:0').split(':').map(Number)
  const day = new Date(after)
  day.setHours(h, m, 0, 0)
  for (let i = 0; i < 8; i++) {
    if (day > after && (!s.days || s.days.includes(day.getDay()))) return day
    day.setDate(day.getDate() + 1)
    day.setHours(h, m, 0, 0)
  }
  return day
}

const from = (s: Schedule) => new Date(s.last ?? s.created)

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "every 30 min", "at 08:00 on Mon, Tue". */
export function whenText(s: When): string {
  if (s.every !== undefined) return s.every % 60 ? `every ${s.every} min` : `every ${s.every / 60} h`
  const days = s.days?.join()
  const on = !s.days ? '' : days === '1,2,3,4,5' ? ' on weekdays' : days === '0,6' ? ' at weekends' : ` on ${s.days.map((d) => DAY_NAMES[d]).join(', ')}`
  return `at ${s.at}${on}`
}

export async function makeSchedules(d: ScheduleDeps): Promise<Schedules> {
  const file = schedulesFile(d.home)
  let all: Schedule[] = []
  try {
    const got = JSON.parse(await readFile(file, 'utf8'))
    if (Array.isArray(got)) all = got.filter((s) => typeof s?.id === 'string' && typeof s.prompt === 'string' && !checkWhen(s))
  } catch {
    // None yet, or a file cut short.
  }

  // Whole, then renamed into place (SCH-5).
  let writes = Promise.resolve()
  const save = () => {
    const copy = JSON.stringify(all, null, 2)
    writes = writes.then(async () => {
      try {
        await mkdir(join(d.home, '.neoai'), { recursive: true, mode: 0o700 })
        await writeFile(`${file}.tmp`, copy, { mode: 0o600 })
        await rename(`${file}.tmp`, file)
        await chmod(file, 0o600)
      } catch {
        // Kept in memory; the next change tries again.
      }
    })
    return writes
  }

  const start = (s: Schedule, now: Date) => {
    s.job = d.start(s.prompt, s.directory, s.id)
    s.last = now.toISOString()
    return s.job
  }

  return {
    list: (now = new Date()) =>
      all
        .map((s) => {
          const next = nextRun(s, from(s))
          // One already due runs at the next look.
          return { ...s, next: (next < now ? now : next).toISOString() }
        })
        .sort((a, b) => a.next.localeCompare(b.next)),
    get: (id) => all.find((s) => s.id === id),
    async add(prompt, directory, when) {
      const s: Schedule = {
        id: randomBytes(4).toString('hex'),
        prompt,
        directory,
        created: new Date().toISOString(),
        ...(when.at !== undefined && { at: when.at }),
        ...(when.days !== undefined && { days: [...new Set(when.days)].sort() }),
        ...(when.every !== undefined && { every: when.every }),
      }
      all.push(s)
      await save()
      return s
    },
    async remove(id) {
      const before = all.length
      all = all.filter((s) => s.id !== id)
      if (all.length === before) return false
      await save()
      return true
    },
    async run(id) {
      const s = all.find((x) => x.id === id)
      if (!s) return
      const job = start(s, new Date())
      await save()
      return job
    },
    async tick(now = new Date()) {
      let changed = false
      for (const s of all) {
        const due = nextRun(s, from(s))
        if (due > now) continue
        changed = true
        // SCH-3 and SCH-4: skipped, and counted as run so the next is the one after.
        if ((s.job && d.busy(s.job)) || now.getTime() - due.getTime() > LATE) s.last = now.toISOString()
        else start(s, now)
      }
      if (changed) await save()
    },
  }
}

/** `30m`, `2h` as minutes (SCH-8). */
export function parseEvery(s: string): number | undefined {
  const m = /^(\d+)\s*(m|min|h)$/.exec(s.trim().toLowerCase())
  if (!m) return
  return Number(m[1]) * (m[2] === 'h' ? 60 : 1)
}

/** `mon,tue`, `weekdays` or `weekends` as days, 0 for Sunday (SCH-8). */
export function parseDays(s: string): number[] | undefined {
  const words = s.toLowerCase().split(/[\s,]+/).filter(Boolean)
  const out: number[] = []
  for (const w of words) {
    if (w === 'weekdays') out.push(1, 2, 3, 4, 5)
    else if (w === 'weekends') out.push(0, 6)
    else {
      const i = DAY_NAMES.findIndex((d) => w.startsWith(d.toLowerCase()))
      if (i < 0) return
      out.push(i)
    }
  }
  return out.length ? [...new Set(out)].sort() : undefined
}

/** "in 25 min", "today 08:00", "tomorrow 08:00", "Mon 08:00". */
export function nextText(next: Date, now = new Date()): string {
  const mins = Math.round((next.getTime() - now.getTime()) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `in ${mins} min`
  const hhmm = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  const days = Math.round((new Date(next).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  return `${days === 0 ? 'today' : days === 1 ? 'tomorrow' : DAY_NAMES[next.getDay()]} ${hhmm}`
}
