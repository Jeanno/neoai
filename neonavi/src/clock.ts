import { readFileSync } from 'node:fs'

/**
 * Local time by this computer's own zone rules (SCH-14), read from its
 * zoneinfo, not the runtime's bundled copy, which can lag: Node 26 shipped
 * tzdata 2026a, with British Columbia still on PST after it moved to
 * permanent UTC-7 on 1 November 2026.
 */

/** Minutes east of UTC at an instant. */
export type Offset = (t: Date) => number

/** A rule in a TZif footer: month, week (5 = last), weekday, and seconds after midnight. */
interface Rule {
  month: number
  week: number
  day: number
  at: number
}

interface Footer {
  std: number
  dst?: { offset: number; start: Rule; end: Rule }
}

/** `7`, `-3:30`, `+5`: hours west of UTC, POSIX style, as seconds. */
function hours(s: string): number {
  const m = /^([+-]?)(\d{1,3})(?::(\d{2}))?(?::(\d{2}))?$/.exec(s)
  if (!m) return NaN
  const v = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)
  return m[1] === '-' ? -v : v
}

/** A TZ string such as `MST7` or `PST8PDT,M3.2.0,M11.1.0`; J and n rules are not read. */
export function parseFooter(tz: string): Footer | undefined {
  const name = String.raw`(?:<[^>]+>|[A-Za-z]{3,})`
  const off = String.raw`[+-]?\d{1,3}(?::\d{2}){0,2}`
  const rule = String.raw`M(\d{1,2})\.(\d)\.(\d)(?:\/(${off}))?`
  const m = new RegExp(`^${name}(${off})(?:${name}(${off})?,${rule},${rule})?$`).exec(tz.trim())
  if (!m) return
  const std = -hours(m[1])
  if (Number.isNaN(std)) return
  if (!m[3]) return { std }
  const at = (s: string | undefined) => (s === undefined ? 7200 : hours(s))
  return {
    std,
    dst: {
      offset: m[2] === undefined ? std + 3600 : -hours(m[2]),
      start: { month: Number(m[3]), week: Number(m[4]), day: Number(m[5]), at: at(m[6]) },
      end: { month: Number(m[7]), week: Number(m[8]), day: Number(m[9]), at: at(m[10]) },
    },
  }
}

/** When a rule falls in a year, as seconds since the epoch in local wall time. */
function ruleTime(year: number, r: Rule): number {
  const first = new Date(Date.UTC(year, r.month - 1, 1)).getUTCDay()
  let date = 1 + ((r.day - first + 7) % 7) + (r.week - 1) * 7
  const days = new Date(Date.UTC(year, r.month, 0)).getUTCDate()
  while (date > days) date -= 7
  return Date.UTC(year, r.month - 1, date) / 1000 + r.at
}

function footerOffset(f: Footer, t: number): number {
  if (!f.dst) return f.std
  const year = new Date(t * 1000 + f.std * 1000).getUTCFullYear()
  // Rules are in wall time: the start in standard time, the end in daylight time.
  const start = ruleTime(year, f.dst.start) - f.std
  const end = ruleTime(year, f.dst.end) - f.dst.offset
  const inDst = start < end ? t >= start && t < end : t >= start || t < end
  return inDst ? f.dst.offset : f.std
}

/** A TZif file's offsets (RFC 8536), or nothing when it does not read. */
export function parseTzif(b: Buffer): Offset | undefined {
  if (b.length < 44 || b.toString('latin1', 0, 4) !== 'TZif') return
  const counts = (o: number) => [20, 24, 28, 32, 36, 40].map((i) => b.readInt32BE(o + i))
  let [isut, isstd, leap, timecnt, typecnt, charcnt] = counts(0)
  let o = 44
  let wide = false
  if (b[4] >= 0x32) {
    // Past the 32-bit block to the 64-bit one.
    o = 44 + timecnt * 5 + typecnt * 6 + charcnt + leap * 8 + isstd + isut
    ;[isut, isstd, leap, timecnt, typecnt, charcnt] = counts(o)
    o += 44
    wide = true
  }
  const size = wide ? 8 : 4
  const times: number[] = []
  for (let i = 0; i < timecnt; i++) times.push(wide ? Number(b.readBigInt64BE(o + i * size)) : b.readInt32BE(o + i * size))
  const idx = o + timecnt * size
  const types = [...b.subarray(idx, idx + timecnt)]
  const info = idx + timecnt
  const offsets: number[] = []
  for (let i = 0; i < typecnt; i++) offsets.push(b.readInt32BE(info + i * 6))
  const end = info + typecnt * 6 + charcnt + leap * (size + 4) + isstd + isut
  const footer = wide ? parseFooter(b.toString('latin1', end).split('\n')[1] ?? '') : undefined
  if (!offsets.length) return
  return (t) => {
    const s = Math.floor(t.getTime() / 1000)
    if ((!times.length || s >= times[times.length - 1]) && footer) return footerOffset(footer, s) / 60
    let lo = 0
    let hi = times.length - 1
    let at = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= s) {
        at = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return offsets[at < 0 ? 0 : types[at]] / 60
  }
}

const runtime: Offset = (t) => -t.getTimezoneOffset()

/** This computer's zone: `TZ` when it names one, else /etc/localtime; the runtime's when neither reads. */
function systemOffset(): Offset {
  const tz = process.env.TZ
  const files = tz ? (/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/.test(tz) ? [`/usr/share/zoneinfo/${tz}`, `/var/db/timezone/zoneinfo/${tz}`] : []) : ['/etc/localtime']
  if (tz && !files.length) return runtime
  for (const f of files) {
    try {
      const read = parseTzif(readFileSync(f))
      if (read) return read
    } catch {
      // Not here; the next, or the runtime's.
    }
  }
  return runtime
}

export const localOffset: Offset = systemOffset()

/** An instant's local wall time, as the UTC fields of a Date. */
export const wall = (t: Date, offset: Offset = localOffset) => new Date(t.getTime() + offset(t) * 60_000)

/** The instant a local wall time falls on (the later, in a fold). */
export function fromWall(y: number, mo: number, d: number, h: number, mi: number, offset: Offset = localOffset): Date {
  const asUtc = Date.UTC(y, mo, d, h, mi)
  let t = new Date(asUtc - offset(new Date(asUtc)) * 60_000)
  t = new Date(asUtc - offset(t) * 60_000)
  return t
}
