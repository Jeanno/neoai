import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, disconnect, findBrowser, makeTab, NO_BROWSER, profileDir, quitBrowser, type Action } from '../src/browser.ts'

const SHOP = `<!doctype html><title>Shop</title><h1>Shop</h1><nav><a href="/about">About</a></nav>
<label>Search <input type=search></label>
<button onclick="document.getElementById('out').textContent = 'Added ' + document.querySelector('input').value">Add</button>
<p id=out></p><select aria-label=Size><option>Small</option><option>Large</option></select>
<form action=/found><input aria-label=Query name=q></form>
<select aria-label=Speed><option>Standard</option><option value=Standard2>Express</option></select>
<a href="/about" target=_blank>About, in a new tab</a>
<a id=away href="/">Next</a>`

let server: Server
let base = ''
let home = ''
// A real Chromium, headless; CI installs it. Elsewhere, without one, these are skipped.
const skip = !process.env.CI && !(await findBrowser()) && 'no Chromium installed (navi browser --install)'

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'navi-browser-'))
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/about') res.end('<title>About</title><h1>About us</h1><p>We sell things.</p>')
    else if (url.pathname === '/framed')
      res.end(`<title>Framed</title><h1>Pay</h1><iframe src="http://localhost:${url.port || (server.address() as { port: number }).port}/inner"></iframe>`)
    else if (url.pathname === '/inner') res.end('<button>Confirm transfer</button>')
    else if (url.pathname === '/focus') res.end('<title>Focus</title><button autofocus>Place order</button>')
    else if (url.pathname === '/deep')
      // Tables in tables, far deeper than Chrome hands back in one piece.
      res.end(`<title>Deep</title><h1>Tree</h1>${'<table><tr><td>'.repeat(30)}<button onclick="this.textContent='Opened'">Open leaf</button>${'</td></tr></table>'.repeat(30)}<p>After the tree</p>`)
    else if (url.pathname === '/late')
      res.end(`<title>Late</title><div id=app>Loading…</div><script>setTimeout(() => {
        document.getElementById('app').innerHTML = '<h1>Dashboard</h1><button>Refresh</button>'
      }, 800)</script>`)
    else if (url.pathname === '/upload')
      res.end(`<title>Apply</title><label>CV <input type=file id=cv onchange="out.textContent='CV: '+this.files[0].name"></label>
<input type=file id=photo hidden onchange="out.textContent='Photo: '+this.files[0].name+' '+this.files[0].size"><button onclick="photo.click()">Choose photo</button><p id=out></p>`)
    else if (url.pathname === '/report.csv') {
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' })
      res.end('month,sales\nApr,91\n')
      return
    } else if (url.pathname === '/files') res.end('<title>Files</title><a href="/report.csv">Monthly report</a>')
    else if (url.pathname === '/never') return // answered only when the server closes
    else if (url.pathname === '/found') res.end(`<title>Found</title><p>Results for ${url.searchParams.get('q')}</p>`)
    else res.end(SHOP)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(async () => {
  await quitBrowser(home).catch(() => {})
  server.closeAllConnections()
  server.close()
  // The browser may still be writing its profile as it goes.
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

/** Approved as asked, then done: what the browser tools do once the user says y. */
async function done(tab: ReturnType<typeof makeTab>, action: Action) {
  const asked = await tab.describe(action)
  if ('problem' in asked) return asked.problem
  return tab.act(action, asked)
}

const refOf = (page: string, element: string) => new RegExp(`${element}.*?\\[ref=([\\w-]+)\\]`).exec(page)?.[1] ?? 'missing'

// BRW-5, BRW-6, BRW-7, BRW-9, BRW-10, BRW-8
test('a page is opened, read and acted on as text', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const page = await tab.open(base)
  assert.match(page, /^Shop\nhttp:\/\/127\.0\.0\.1:\d+\/\n\nheading "Shop" \[level=1\]\nnavigation\n  link "About" \[ref=\w+\]/)
  assert.match(await tab.read({ find: 'about' }), /^\d+: link "About" \[ref=\w+\] \(under navigation\)\n/)
  // Started for this session, the browser has its tab and no blank one beside it.
  assert.deepEqual((await connect({ home, headless: true })).contexts()[0].pages().map((p) => p.url()), [`${base}/`])

  const typed = await done(tab, { kind: 'type', ref: refOf(page, 'searchbox "Search"'), text: 'socks' })
  assert.match(typed, /^appeared on the page:\n\+ searchbox "Search" \[ref=\w+\]: socks\n1 line went from the page$/)
  assert.match(await done(tab, { kind: 'click', ref: refOf(page, 'button "Add"') }), /^appeared on the page:\n\+ text: Added socks$/)
  assert.match(await done(tab, { kind: 'select', ref: refOf(page, 'combobox "Size"'), option: 'Large' }), /\+ option "Large" \[selected\]/)
  assert.equal(await done(tab, { kind: 'press', key: 'Shift' }), 'nothing on the page changed')

  const searched = await done(tab, { kind: 'type', ref: refOf(page, 'textbox "Query"'), text: 'hats', submit: true })
  assert.match(searched, /^Found\nhttp:\/\/127\.0\.0\.1:\d+\/found\?q=hats\n\ntext: Results for hats$/)
  assert.match(await tab.back(), /^Shop\n/)
  assert.match(await done(tab, { kind: 'click', ref: refOf(page, 'link "About"') }), /^About\n.*\/about\n\nheading "About us" \[level=1\]\ntext: We sell things\.$/)
  assert.match((await tab.read({})).split('\n')[0], /\/about$/)
})

// BRW-9, BRW-11, BRW-6
test('a gone ref is reported, and only http and https are opened', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  await tab.open(base)
  assert.deepEqual(await tab.describe({ kind: 'click', ref: 'e999' }), {
    problem: 'No element [ref=e999] is on the page now; read the page again.',
  })
  const page = await tab.read({})
  const d = await tab.describe({ kind: 'click', ref: refOf(page, 'button "Add"') })
  assert.deepEqual(d, { line: `click button "Add" on ${new URL(base).host}`, url: `${base}/` })
  assert.equal(await tab.open('file:///etc/passwd'), 'Only http and https pages are opened, not file:')
  assert.match(await tab.open('nonsense'), /is not a URL/)
})

// BRW-2, BRW-3: one browser, a tab per session, still there for the next navi.
test('sessions share one browser that outlives the connection', { skip }, async () => {
  const one = makeTab({ home, headless: true })
  const two = makeTab({ home, headless: true })
  await one.open(`${base}/about?one`)
  await two.open(`${base}/?two`)
  const browser = await connect({ home, headless: true })
  assert.equal(browser.contexts().length, 1)
  // The session's own tab, closed by the user, is opened afresh.
  await browser.contexts()[0].pages().find((p) => p.url().endsWith('?one'))!.close()
  assert.match(await one.read({}), /^about:blank\n/)
  assert.match(await one.open(`${base}/about?again`), /^About\n/)
  await disconnect(home)
  // As another navi would: found through the profile, not started again.
  const again = await connect({ home, headless: true })
  assert.notEqual(again, browser)
  const open = again.contexts()[0].pages().map((p) => p.url())
  assert.ok(open.includes(`${base}/about?again`) && open.includes(`${base}/?two`), open.join(', '))
})

// BRW-14, BRW-15: several tabs, and the ones a page opens itself.
test('a session works across tabs it opens, and tabs pages open', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const shop = await tab.open(base)
  assert.match(await tab.open(`${base}/about?second`, { newTab: true }), /^\[tab t2\] About\n/)
  assert.match(await tab.tabs(), /^  t1  Shop — http:\/\/[^\n]+\/\n\* t2  About — [^\n]+\/about\?second\n/)
  assert.match(await tab.switchTo('t1'), /^\[tab t1\] Shop\n/)
  // Acts land in the current tab: t1's refs are t1's.
  const popup = await done(tab, { kind: 'click', ref: refOf(shop, 'link "About, in a new tab"') })
  assert.match(popup, /^It opened a new tab, t3, now the current one\.\n\[tab t3\] About\n.*\/about\n/)
  assert.match(await tab.tabs(), /\* t3  About/)
  assert.equal(await tab.close('t3'), 'Closed t3; the current tab is t2.')
  assert.equal(await tab.switchTo('t9'), 'There is no open tab t9; browser_tabs lists them.')
})

// BRW-11: what approval reads says where an action really lands.
test('approval names the focused element, a frame, and where a link goes', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const host = new URL(base).host
  await tab.open(`${base}/focus`)
  assert.deepEqual(await tab.describe({ kind: 'press', key: 'Enter' }), {
    line: `press Enter in button "Place order" on ${host}`,
    url: `${base}/focus`,
  })
  const framed = await tab.open(`${base}/framed`)
  const inner = await tab.describe({ kind: 'click', ref: refOf(framed, 'button "Confirm transfer"') })
  assert.equal('line' in inner && inner.line, `click button "Confirm transfer" on localhost:${new URL(base).port} (in a frame on ${host})`)
  const shop = await tab.open(base)
  const away = await tab.describe({ kind: 'click', ref: refOf(shop, 'link "Next"') })
  assert.equal('line' in away && away.line, `click link "Next" on ${host}`)
})

// BRW-11, BRW-9: approved on one page, nothing is done on another; options go by label only.
test('an approval does not carry over to a page that moved on, and options go by label', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const shop = await tab.open(base)
  const action: Action = { kind: 'click', ref: refOf(shop, 'button "Add"') }
  const asked = await tab.describe(action)
  assert.ok('line' in asked)
  await tab.open(`${base}/about`)
  assert.equal(await tab.act(action, asked), 'The page changed since the action was approved; nothing was done. Read the page again.')
  const again = await tab.open(base)
  const picked = await done(tab, { kind: 'select', ref: refOf(again, 'combobox "Speed"'), option: 'Standard2' })
  assert.match(picked, /^could not select: /)
  assert.match(await tab.read({ find: 'Standard' }), /option "Standard" \[selected\]/)
})

// BRW-9: a page drawn by scripts after it loads reads as drawn.
test('a page drawn late by scripts is read once drawn', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const late = await tab.open(`${base}/late`)
  assert.match(late, /heading "Dashboard"/)
  assert.match(late, /button "Refresh" \[ref=/)
  assert.doesNotMatch(late, /Loading/)
})

// BRW-5: a page nested too deep to read in one piece is read in parts, its refs all usable.
test('a deeply nested page is read whole, and acted on', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const deep = await tab.open(`${base}/deep`)
  assert.match(deep, /text: After the tree/)
  assert.equal(await done(tab, { kind: 'click', ref: refOf(deep, 'button "Open leaf"') }), 'appeared on the page:\n+ button "Opened" [ref=' + refOf(await tab.read({ find: 'Opened' }), 'button "Opened"') + ']\n1 line went from the page')
})

// BRW-4
test('with no browser, the tools say how to get one', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'navi-nobrowser-'))
  try {
    // A configured one that is not there is named, rather than another started in its place.
    const missing = '"browser": { "executable" } in ~/.neoai/config.json names /nowhere/chrome, which does not exist.'
    await assert.rejects(findBrowser('/nowhere/chrome'), { message: missing })
    const tab = makeTab({ home: empty, executable: '/nowhere/chrome' })
    assert.equal(await tab.open('https://example.com'), `could not open https://example.com: ${missing}`)
    assert.match(NO_BROWSER, /navi browser --install/)
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

// BRW-16: seen live, a browser that answers on its port but never lets Playwright attach.
test('a browser that answers but will not be attached to is asked to close, and a fresh one used', { skip }, async () => {
  const own = await mkdtemp(join(tmpdir(), 'navi-browser-'))
  const asked: string[] = []
  const held: import('node:stream').Duplex[] = []
  const stuck = createServer((req, res) => {
    const { port } = stuck.address() as { port: number }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ Browser: 'Chrome/1', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/stuck` }))
  })
  stuck.on('upgrade', (_req, socket) => {
    held.push(socket)
    asked.push('upgrade')
    // The first is Playwright's, left hanging; the next is navi asking it to close, which it does.
    if (asked.length > 1) {
      for (const s of held) s.destroy()
      stuck.close()
    }
  })
  await new Promise<void>((r) => stuck.listen(0, '127.0.0.1', r))
  await mkdir(profileDir(own), { recursive: true })
  await writeFile(join(profileDir(own), 'DevToolsActivePort'), `${(stuck.address() as { port: number }).port}\n/devtools/browser/stuck`)
  try {
    const tab = makeTab({ home: own, headless: true, attachMs: 1500 })
    assert.match(await tab.open(`${base}/about`), /^About\n/)
    assert.equal(asked.length, 2)
    assert.equal(stuck.listening, false)
  } finally {
    await quitBrowser(own).catch(() => {})
    stuck.close()
    await rm(own, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

// BRW-17
test('a page that never loads is read as not loaded yet, without waiting on it', { skip }, async () => {
  const tab = makeTab({ home, headless: true, loadMs: 1000 })
  assert.match(await tab.open(`${base}/never`), /^could not open .*\/never: .*Timeout/)
  const started = Date.now()
  assert.match(await tab.read({}), /has not finished loading; read it again in a moment, or open it again/)
  assert.ok(Date.now() - started < 9000, `read took ${Date.now() - started}ms`)
  // And the tab is not spoiled for the next page.
  assert.match(await tab.open(`${base}/about`), /^About\n/)
})

// BRW-19
test('a file goes into a file field, or through the chooser a button opens', { skip }, async () => {
  const tab = makeTab({ home, headless: true })
  const page = await tab.open(`${base}/upload`)
  const file = join(home, 'cv.pdf')
  await writeFile(file, 'twelve bytes')
  for (const [element, shows] of [
    ['button "CV"', /CV: cv\.pdf/],
    ['button "Choose photo"', /Photo: cv\.pdf 12/],
  ] as const) {
    const action = { kind: 'upload' as const, ref: refOf(page, element), path: file, size: 12 }
    const d = await tab.describe(action)
    assert.ok('line' in d, JSON.stringify(d))
    assert.match(d.line, new RegExp(`^upload ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(12 B\\) into `))
    assert.match(await tab.act(action, d), shows)
  }
})

// BRW-20
test('a download is kept in the working directory, never over a file there', { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-downloads-'))
  try {
    const tab = makeTab({ home, headless: true })
    const page = await tab.open(`${base}/files`, { saveIn: dir })
    const action = { kind: 'click' as const, ref: refOf(page, 'link "Monthly report"') }
    for (const name of ['report.csv', 'report (2).csv']) {
      const d = await tab.describe(action)
      assert.ok('line' in d)
      const said = await tab.act(action, d, dir)
      assert.ok(said.endsWith(`It downloaded report.csv (19 B), saved as ${join(dir, name)}.`), said)
      assert.equal(await readFile(join(dir, name), 'utf8'), 'month,sales\nApr,91\n')
    }
    assert.equal(await tab.open(`${base}/report.csv`, { saveIn: dir }), `It downloaded report.csv (19 B), saved as ${join(dir, 'report (3).csv')}.`)
    assert.match(await tab.open(`${base}/report.csv`), /not kept: there is nowhere to keep it/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

