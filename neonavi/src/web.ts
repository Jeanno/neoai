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
