import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatResults, parseResults, searchBackend, webSearch } from '../src/web.ts'
import { makeTools } from '../src/tools.ts'
import { systemPrompt } from '../src/args.ts'

// Trimmed from a real html.duckduckgo.com response: one ad, one plain result,
// one wrapped in DuckDuckGo's redirect, entities in the title and snippet.
const PAGE = `
<div class="result results_links results_links_deep result--ad ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://ads.example/buy">Buy Now</a></h2>
  <a class="result__snippet" href="https://ads.example/buy">Sponsored</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://en.wikipedia.org/wiki/Zhuge_Liang">Zhuge Liang - Wikipedia</a>
  </h2>
  <a class="result__snippet" href="https://en.wikipedia.org/wiki/Zhuge_Liang"><b>Zhuge</b> <b>Liang</b> (181&#x2013;234), courtesy name Kongming.</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;rut=abc">Tom &amp; Jerry&#x27;s &quot;page&quot;</a>
  </h2>
  <a class="result__snippet" href="#">Less &lt;than&gt; more</a>
</div>
`

// TL-27
test('parses title, url and snippet from each organic result', () => {
  const [first] = parseResults(PAGE)
  assert.deepEqual(first, {
    title: 'Zhuge Liang - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Zhuge_Liang',
    snippet: 'Zhuge Liang (181–234), courtesy name Kongming.',
  })
})

// TL-27
test('drops ads', () => {
  assert.ok(parseResults(PAGE).every((r) => !r.url.includes('ads.example')))
})

// TL-27
test('unwraps redirect links and decodes entities', () => {
  const second = parseResults(PAGE)[1]
  assert.equal(second.url, 'https://example.com/a?b=1')
  assert.equal(second.title, `Tom & Jerry's "page"`)
  assert.equal(second.snippet, 'Less <than> more')
})

// TL-26
test('keeps at most 8 results, numbered for citation', () => {
  const block = PAGE.split('<div class="result results_links results_links_deep web-result ">')[1]
  const many = Array.from({ length: 12 }, () => `<div class="result web-result ">${block}`).join('')
  const results = parseResults(many)
  assert.equal(results.length, 8)
  const out = formatResults('zhuge liang', results)
  assert.match(out, /^1\. Zhuge Liang - Wikipedia\n   https:\/\/en\.wikipedia\.org\/wiki\/Zhuge_Liang\n   Zhuge Liang/m)
  assert.match(out, /^8\. /m)
  assert.doesNotMatch(out, /^9\. /m)
})

// TL-28: the query is the only thing sent.
test('sends only the query', async () => {
  let sent: { url: string; body: string } | undefined
  const fake = async (url: any, init: any) => {
    sent = { url: String(url), body: String(init.body) }
    return new Response(PAGE, { status: 200 })
  }
  await webSearch('zhuge liang', fake as typeof fetch)
  assert.equal(sent?.url, 'https://html.duckduckgo.com/html/')
  assert.equal(sent?.body, 'q=zhuge+liang')
})

// TL-29
test('no results is a normal answer', async () => {
  const fake = async () => new Response('<html>nothing</html>', { status: 200 })
  assert.equal(await webSearch('xyzzy', fake as typeof fetch), 'no results for xyzzy')
})

// TL-29
test('a failed or blocked request says search is unavailable instead of throwing', async () => {
  const down = async () => {
    throw new Error('ENOTFOUND')
  }
  const blocked = async () => new Response('captcha', { status: 403 })
  assert.match(await webSearch('q', down as typeof fetch), /^web search is unavailable/)
  assert.match(await webSearch('q', blocked as typeof fetch), /^web search is unavailable \(DuckDuckGo answered HTTP 403\)/)
})

// TL-29: DuckDuckGo's bot check is a block, never "no results".
test("DuckDuckGo's bot check says search is rate-limited, not that nothing was found", async () => {
  const check = async () => new Response('<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>', { status: 202 })
  const out = await webSearch('q', check as typeof fetch)
  assert.match(out, /^web search is unavailable \(DuckDuckGo is rate-limiting searches from here for now\)/)
  assert.doesNotMatch(out, /no results/)
})

// TL-44
test('a search backend comes from the config, or Brave from its environment key', () => {
  assert.deepEqual(searchBackend({ searxng: 'http://box:8888' }, {}), { searxng: 'http://box:8888' })
  assert.deepEqual(searchBackend({ brave: 'k' }, {}), { brave: 'k' })
  assert.deepEqual(searchBackend(undefined, { BRAVE_SEARCH_API_KEY: 'e' }), { brave: 'e' })
  assert.equal(searchBackend(undefined, {}), undefined)
  assert.equal(searchBackend({ searxng: 7 }, {}), undefined)
})

// TL-44, TL-28
test('SearXNG and Brave are asked first, with the query and nothing else but Brave\'s key', async () => {
  const sent: { url: string; headers: Record<string, string> }[] = []
  const fake = async (url: any, init: any) => {
    sent.push({ url: String(url), headers: init?.headers ?? {} })
    if (String(url).startsWith('http://box'))
      return Response.json({ results: [{ title: 'A <b>page</b>', url: 'https://a.example', content: 'about &amp; more' }] })
    return Response.json({ web: { results: [{ title: 'B', url: 'https://b.example', description: 'the <strong>b</strong> page' }] } })
  }
  const viaSearx = await webSearch('two words', fake as typeof fetch, { searxng: 'http://box/' })
  assert.equal(viaSearx, '1. A page\n   https://a.example\n   about & more')
  assert.equal(sent[0].url, 'http://box/search?q=two+words&format=json')
  const viaBrave = await webSearch('two words', fake as typeof fetch, { brave: 'KEY' })
  assert.equal(viaBrave, '1. B\n   https://b.example\n   the b page')
  assert.equal(sent[1].url, 'https://api.search.brave.com/res/v1/web/search?q=two+words&count=8')
  assert.equal(sent[1].headers['x-subscription-token'], 'KEY')
  assert.equal(sent.length, 2)
})

// TL-44
test('a backend that fails falls back to DuckDuckGo, and both failing names each', async () => {
  const refused = (ddg: Response) => async (url: any) =>
    String(url).includes('duckduckgo') ? ddg : new Response('no', { status: 403 })
  const fallback = await webSearch('zhuge liang', refused(new Response(PAGE)) as typeof fetch, { searxng: 'http://box' })
  assert.match(fallback, /^1\. /)
  const both = await webSearch('q', refused(new Response('', { status: 503 })) as typeof fetch, { brave: 'bad' })
  assert.equal(both, 'web search is unavailable (Brave Search refused the key; DuckDuckGo answered HTTP 503); answer without it')
  const json = await webSearch('q', refused(new Response('', { status: 503 })) as typeof fetch, { searxng: 'http://box' })
  assert.match(json, /SearXNG at http:\/\/box refuses JSON \(turn on json/)
})

// TL-30
test('web_search is a tool unless the config turns it off', () => {
  assert.ok('web_search' in makeTools({ approve: async () => false }))
  assert.ok(!('web_search' in makeTools({ approve: async () => false }, { web: false })))
})

// PRM-9
test('the prompt mentions web search only when it is available', () => {
  assert.match(systemPrompt('/x', [], '', true), /web_search/)
  assert.doesNotMatch(systemPrompt('/x', [], '', false), /web_search/)
})
