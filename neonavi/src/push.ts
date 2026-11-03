/**
 * Job notifications sent to a phone through ntfy (push.md).
 */

export interface PushConfig {
  /** The server, without the topic. */
  server: string
  topic: string
  /** Whether the prompt and command may leave this computer (PSH-2). */
  detail: boolean
  /** Only what needs the user is pushed (PSH-18). */
  waiting: boolean
  /** Set up, but nothing is pushed (PSH-19). */
  off: boolean
}

/** The push config, or nothing when there is none or it does not read (PSH-1). */
export function pushConfig(config: { push?: unknown }): PushConfig | undefined {
  const raw = config.push
  const o = typeof raw === 'string' ? { url: raw } : raw && typeof raw === 'object' ? (raw as { url?: unknown; detail?: unknown; notify?: unknown }) : undefined
  if (typeof o?.url !== 'string') return
  let url: URL
  try {
    url = new URL(o.url)
  } catch {
    return
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (!['http:', 'https:'].includes(url.protocol) || !parts.length) return
  const topic = parts.pop()!
  return { server: `${url.origin}${parts.length ? `/${parts.join('/')}` : ''}`, topic, detail: o.detail === true, waiting: o.notify === 'waiting', off: o.notify === false }
}

/** How much the Mac or the phone is told (JOB-39). */
export type Level = 'all' | 'waiting' | 'off'
export const LEVELS: readonly Level[] = ['all', 'waiting', 'off']

const levelOf = (v: unknown): Level => (v === false ? 'off' : v === 'waiting' ? 'waiting' : 'all')
const valueOf = (l: Level) => (l === 'off' ? false : l === 'waiting' ? 'waiting' : undefined)

/** What the Mac and the phone are told; the phone is null with no push (JOB-39). */
export function notifyLevels(config: Record<string, any>): { mac: Level; phone: Level | null } {
  const p = pushConfig(config)
  return { mac: levelOf(config.notify), phone: p ? (p.off ? 'off' : p.waiting ? 'waiting' : 'all') : null }
}

/**
 * The config with the Mac's and the phone's levels set, and nothing else
 * changed; `all` takes the setting out (JOB-39). A phone with no push is a
 * problem, said as a string.
 */
export function withLevels(config: Record<string, any>, set: { mac?: Level; phone?: Level }): Record<string, any> | string {
  if (set.phone !== undefined && !pushConfig(config)) return 'No push is set up for the phone; navi push test says how.'
  const next = { ...config }
  if (set.mac !== undefined) {
    const v = valueOf(set.mac)
    if (v === undefined) delete next.notify
    else next.notify = v
  }
  if (set.phone !== undefined) {
    const p = typeof next.push === 'string' ? { url: next.push } : { ...next.push }
    const v = valueOf(set.phone)
    if (v === undefined) delete p.notify
    else p.notify = v
    // A push given as its URL alone stays so when nothing is added to it.
    next.push = typeof config.push === 'string' && Object.keys(p).length === 1 ? p.url : p
  }
  return next
}

export interface PushMessage {
  title: string
  /** The job's id (PSH-2). */
  job?: string
  /** What happened in full: the prompt, the command; sent only with detail. */
  detail?: string
  /** Words that are always safe to send, such as a test's. */
  note?: string
  /** The phone page, without the token (PSH-3). */
  click?: string
  urgent?: boolean
  /** Where Yes and No post their answer (PSH-7); sent only with detail (PSH-9). */
  answer?: string
}

/** Sends one push; why it failed, or nothing (PSH-4). */
export async function push(p: PushConfig, m: PushMessage, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const message = [m.job && `Job ${m.job}`, m.note, p.detail && m.detail].filter(Boolean).join(': ') || m.title
  // JSON, not headers: a title or prompt need not be ASCII.
  const body = {
    topic: p.topic,
    title: m.title,
    message,
    ...(m.click && { click: m.click }),
    priority: m.urgent ? 4 : 3,
    tags: [m.urgent ? 'raised_hand' : 'robot'],
    // PSH-7: the phone itself posts the answer, so it goes over the tailnet, not through ntfy.
    ...(m.answer && p.detail && {
      actions: (['no', 'yes'] as const).map((said) => ({
        action: 'http',
        label: said === 'yes' ? 'Yes' : 'No',
        url: m.answer,
        method: 'POST',
        body: said,
        clear: true,
      })),
    }),
  }
  try {
    const r = await fetchImpl(p.server, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    return r.ok ? undefined : `the push server answered ${r.status}`
  } catch (e) {
    return e instanceof Error && e.name === 'TimeoutError' ? 'the push server took more than 5 seconds' : 'the push server could not be reached'
  }
}
