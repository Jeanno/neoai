export interface Result {
  title: string
  url: string
  snippet: string
}

const ENDPOINT = 'https://html.duckduckgo.com/html/'
const MAX_RESULTS = 8
const TIMEOUT_MS = 10_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** DuckDuckGo sometimes links through //duckduckgo.com/l/?uddg=<destination>. */
function destination(href: string): string {
  const raw = text(href)
  const wrapped = /[?&]uddg=([^&]+)/.exec(raw)
  return wrapped ? decodeURIComponent(wrapped[1]) : raw
}

/**
 * The HTML endpoint, not the JSON "instant answer" API: that one returns
 * Wikipedia abstracts, not search results. No key, no account — the same
 * no-configuration promise as the rest of navi (TL-27).
 */
export function parseResults(html: string): Result[] {
  const results: Result[] = []
  for (const block of html.split(/<div class="result\b/).slice(1)) {
    if (/^[^>]*result--ad/.test(block)) continue
    const link = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    results.push({ title: text(link[2]), url: destination(link[1]), snippet: snippet ? text(snippet[1]) : '' })
    if (results.length === MAX_RESULTS) break
  }
  return results
}

/** Numbered, so the model can cite "[2]" and the user can follow it (TL-26). */
export function formatResults(query: string, results: Result[]): string {
  if (!results.length) return `no results for ${query}`
  return results
    .map((r, i) => [`${i + 1}. ${r.title}`, `   ${r.url}`, ...(r.snippet ? [`   ${r.snippet}`] : [])].join('\n'))
    .join('\n')
}

/** Never throws: a model that cannot search can still answer from what it knows (TL-29). */
export async function webSearch(query: string, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // The query and nothing else (TL-28).
      body: new URLSearchParams({ q: query }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return `web search is unavailable (HTTP ${res.status}); answer without it`
    return formatResults(query, parseResults(await res.text()))
  } catch (e) {
    return `web search is unavailable (${e instanceof Error ? e.message : String(e)}); answer without it`
  }
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 2_000_000
const MAX_REDIRECTS = 5
const TEXT_TYPES = /^(text\/|application\/(json|xml|[\w.+-]*\+(json|xml)|javascript)\b)/

/** A page must not reach this machine or the local network (TL-33). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  if (h.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
    if (mapped) return isPrivateHost(mapped[1])
    return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
  }
  // A bare number is an IPv4 address in disguise (http://2130706433/).
  return /^(0x[0-9a-f]+|\d+)$/.test(h)
}

/** Title, then readable text with block elements as line breaks (TL-32). */
export function pageText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|main|header|footer|nav|aside|h[1-6]|li|ul|ol|tr|table|pre|blockquote|dt|dd)\b[^>]*>/gi, '\n')
    // Before splitting: a tag may span lines.
    .replace(/<[^>]+>/g, '')
  const lines = body.split('\n').map(text).filter(Boolean)
  return [...(title ? [`# ${text(title[1])}`, ''] : []), ...lines].join('\n')
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES))
}

/** Never throws, like webSearch: a page that cannot be read is a normal result (TL-34). */
export async function fetchUrl(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    let target = new URL(url)
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    for (let hop = 0; ; hop++) {
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return `cannot fetch ${target.href}: only http and https`
      if (isPrivateHost(target.hostname)) return `refused ${target.href}: it is on this machine or the local network`
      // The URL and nothing else: no cookies, no referrer (TL-34).
      const res = await fetcher(target.href, { redirect: 'manual', signal, headers: { 'user-agent': 'navi', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' } })
      const next = res.status >= 300 && res.status < 400 && res.headers.get('location')
      if (next) {
        if (hop === MAX_REDIRECTS) return `cannot fetch ${url}: more than ${MAX_REDIRECTS} redirects`
        target = new URL(next, target)
        continue
      }
      if (!res.ok) return `cannot fetch ${target.href}: HTTP ${res.status}`
      const type = (res.headers.get('content-type') ?? 'text/plain').split(';')[0].trim().toLowerCase()
      if (!TEXT_TYPES.test(type)) return `${target.href} is ${type}, not text; it was not read`
      const body = await readCapped(res)
      return type === 'text/html' || type === 'application/xhtml+xml' ? pageText(body) || '(no text on the page)' : body
    }
  } catch (e) {
    return `cannot fetch ${url} (${e instanceof Error ? e.message : String(e)})`
  }
}
