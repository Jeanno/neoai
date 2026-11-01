/**
 * Job notifications sent to a phone through ntfy (push.md).
 */

export interface PushConfig {
  /** The server, without the topic. */
  server: string
  topic: string
  /** Whether the prompt and command may leave this computer (PSH-2). */
  detail: boolean
}

/** The push config, or nothing when there is none or it does not read (PSH-1). */
export function pushConfig(config: { push?: unknown }): PushConfig | undefined {
  const raw = config.push
  const o = typeof raw === 'string' ? { url: raw } : raw && typeof raw === 'object' ? (raw as { url?: unknown; detail?: unknown }) : undefined
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
  return { server: `${url.origin}${parts.length ? `/${parts.join('/')}` : ''}`, topic, detail: o.detail === true }
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
