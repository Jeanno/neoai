import { localOffset, wall, type Offset } from './clock.ts'

/** Holding notifications at night (push.md, PSH-11 to PSH-13). */

/** A span of the day, in minutes since midnight, local time; `from` after `to` crosses midnight. */
export interface Quiet {
  from: number
  to: number
}

/** `"22:00-07:00"` as a span, or undefined when it is not one (PSH-11). */
export function parseQuiet(value: unknown): Quiet | undefined {
  const m = typeof value === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(value) : null
  if (!m) return
  const [h1, m1, h2, m2] = m.slice(1).map(Number)
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return
  const from = h1 * 60 + m1
  const to = h2 * 60 + m2
  return from === to ? undefined : { from, to }
}

export function isQuiet(q: Quiet, now: Date, offset: Offset = localOffset): boolean {
  const w = wall(now, offset)
  const m = w.getUTCHours() * 60 + w.getUTCMinutes()
  return q.from < q.to ? m >= q.from && m < q.to : m >= q.from || m < q.to
}

export interface Held {
  title: string
  text: string
  job: string
}

const NAMED = 3

/** What was held, as one notification (PSH-12). */
export function digest(held: Held[]): Held {
  const kinds: [string, (h: Held) => boolean][] = [
    ['done', (h) => /\bdone\b/.test(h.title)],
    ['failed', (h) => /\bfailed\b/.test(h.title)],
    ['waiting for you', (h) => /\bwaiting\b/.test(h.title)],
  ]
  const counted = kinds.map(([word, is]) => [word, held.filter(is).length] as const).filter(([, n]) => n > 0)
  const rest = held.filter((h) => !kinds.some(([, is]) => is(h))).length
  const counts = [...counted.map(([word, n]) => `${n} ${word}`), ...(rest ? [`${rest} more`] : [])].join(', ')
  // A job named once, as its latest word on it.
  const latest: Held[] = []
  for (const h of [...held].reverse()) if (!latest.some((l) => l.job === h.job)) latest.push(h)
  const named = latest.slice(0, NAMED)
  const more = latest.length - named.length
  const lines = named.map((h) => `${h.title.replace(/^navi /, '')}: ${h.text}`)
  return {
    title: 'navi, during quiet hours',
    text: [counts, ...lines, ...(more > 0 ? [`and ${more} more`] : [])].join('\n'),
    job: held[held.length - 1].job,
  }
}

type Send = (title: string, text: string, job: string, urgent?: boolean, key?: string) => void

/**
 * A notifier that holds what comes in quiet hours and sends it as one when
 * they end (PSH-11, PSH-12). `quiet` reads the config each time; `flush`
 * is called every so often.
 */
export function makeQuietNotify(
  send: Send,
  quiet: () => Promise<Quiet | undefined>,
  log: (line: string) => void = () => {},
  now = () => new Date(),
  offset: Offset = localOffset,
) {
  let held: Held[] = []
  const hushed = async () => {
    const q = await quiet()
    return !!q && isQuiet(q, now(), offset)
  }
  return {
    notify: ((title, text, job, urgent, key) =>
      void hushed().then((yes) => {
        if (yes) {
          held.push({ title, text, job })
          log(`quiet hours: held a notification for job ${job}`)
        } else send(title, text, job, urgent, key)
      })) as Send,
    async flush() {
      if (!held.length || (await hushed())) return
      const d = digest(held)
      log(`quiet hours over: sent ${held.length} held as one`)
      held = []
      send(d.title, d.text, d.job)
    },
    held: () => held.length,
  }
}
