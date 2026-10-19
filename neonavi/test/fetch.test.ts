import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchUrl, isPrivateHost, pageText } from '../src/web.ts'
import { makeTools } from '../src/tools.ts'
import { systemPrompt } from '../src/args.ts'

const html = (body: string, type = 'text/html; charset=utf-8') =>
  new Response(body, { status: 200, headers: { 'content-type': type } })

const PAGE = `<!doctype html><html><head><title>Red Cliffs &amp; after</title>
<style>p { color: red }</style><script>alert(1)</script></head>
<body><nav>Home</nav><h1>The battle</h1><p>Fought in <b>208</b>.</p><!-- hidden -->
<ul><li>Cao Cao</li><li>Sun Quan</li></ul><noscript>enable js</noscript></body></html>`

// TL-32
test('a page becomes its title and readable text, one block per line', () => {
  const out = pageText(PAGE)
  assert.equal(out, '# Red Cliffs & after\n\nHome\nThe battle\nFought in 208.\nCao Cao\nSun Quan')
})

// TL-32
test('html is reduced, plain text and json come back as they are', async () => {
  assert.match(await fetchUrl('https://example.com/', async () => html(PAGE)), /^# Red Cliffs/)
  const json = '{"a": 1}'
  assert.equal(await fetchUrl('https://example.com/a.json', async () => html(json, 'application/json')), json)
  assert.equal(await fetchUrl('https://example.com/a.md', async () => html('# hi\n', 'text/markdown')), '# hi\n')
})

// TL-32
test('an image or a pdf is named, not read', async () => {
  const out = await fetchUrl('https://example.com/a.pdf', async () => html('%PDF-1.7', 'application/pdf'))
  assert.equal(out, 'https://example.com/a.pdf is application/pdf, not text; it was not read')
})

// TL-33
test('this machine and the local network are refused', () => {
  for (const h of ['localhost', 'api.localhost', 'nas.local', 'db.internal', '127.0.0.1', '10.1.2.3', '172.20.0.1',
    '192.168.1.1', '169.254.169.254', '100.100.0.1', '0.0.0.0', '[::1]', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2130706433'])
    assert.ok(isPrivateHost(h), h)
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111', 'local.example.com'])
    assert.ok(!isPrivateHost(h), h)
})

// TL-33
test('nothing is sent to a refused address, even through a redirect', async () => {
  const asked: string[] = []
  const fake = async (url: any) => {
    asked.push(String(url))
    return new Response('', { status: 302, headers: { location: 'http://192.168.1.1/admin' } })
  }
  assert.match(await fetchUrl('http://localhost:3000/', fake as typeof fetch), /^refused http:\/\/localhost:3000\//)
  assert.deepEqual(asked, [])
  assert.match(await fetchUrl('https://example.com/go', fake as typeof fetch), /^refused http:\/\/192\.168\.1\.1\/admin/)
  assert.deepEqual(asked, ['https://example.com/go'])
  assert.match(await fetchUrl('file:///etc/passwd', fake as typeof fetch), /only http and https/)
})

// TL-33
test('redirects are followed, at most 5 times', async () => {
  let n = 0
  const hop = async (url: any) => {
    n++
    const at = Number(new URL(String(url)).pathname.slice(1) || 0)
    return at < 3
      ? new Response('', { status: 301, headers: { location: `/${at + 1}` } })
      : html('<p>arrived</p>')
  }
  assert.equal(await fetchUrl('https://example.com/', hop as typeof fetch), 'arrived')
  assert.equal(n, 4)
  const loop = async () => new Response('', { status: 302, headers: { location: '/again' } })
  assert.match(await fetchUrl('https://example.com/', loop as typeof fetch), /more than 5 redirects/)
})

// TL-34: the URL is the only thing sent.
test('sends a bare GET for the url', async () => {
  let init: RequestInit | undefined
  await fetchUrl('https://example.com/p?q=1', (async (_: any, i: RequestInit) => {
    init = i
    return html('<p>x</p>')
  }) as typeof fetch)
  assert.equal(init?.method, undefined)
  assert.equal(init?.body, undefined)
  assert.deepEqual(Object.keys(init?.headers ?? {}).sort(), ['accept', 'user-agent'])
})

// TL-34
test('failures come back as messages, never throws', async () => {
  const down = async () => {
    throw new Error('ENOTFOUND')
  }
  assert.equal(await fetchUrl('https://nowhere.example/', down as typeof fetch), 'cannot fetch https://nowhere.example/ (ENOTFOUND)')
  assert.equal(await fetchUrl('https://example.com/x', async () => new Response('', { status: 404 })), 'cannot fetch https://example.com/x: HTTP 404')
  assert.match(await fetchUrl('not a url'), /^cannot fetch not a url/)
})

// TL-34
test('at most 2 MB is read', async () => {
  const big = 'a'.repeat(3_000_000)
  const out = await fetchUrl('https://example.com/big.txt', async () => html(big, 'text/plain'))
  assert.equal(out.length, 2_000_000)
})

// TL-30, TL-35
test('fetch_url goes with web_search off, or alone with fetch off', () => {
  const approve = async () => false
  assert.ok('fetch_url' in makeTools({ approve }))
  assert.ok(!('fetch_url' in makeTools({ approve }, { web: false })))
  const only = makeTools({ approve }, { fetch: false })
  assert.ok(!('fetch_url' in only) && 'web_search' in only)
})

// PRM-10
test('the prompt mentions fetch_url only when it is a tool', () => {
  assert.match(systemPrompt('/tmp/x', [], '', true, true), /fetch_url/)
  assert.doesNotMatch(systemPrompt('/tmp/x', [], '', true, false), /fetch_url/)
})

// TL-32
test('a tag spanning lines leaves no markup behind', () => {
  assert.equal(pageText('<html\nlang="en"\ndata-x="1"><body><span\nclass="a">hi</span></body></html>'), 'hi')
})
