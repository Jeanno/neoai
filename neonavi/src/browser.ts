import { execFile, spawn } from 'node:child_process'
import { access, copyFile, lstat, mkdir, readFile, readlink, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'
import type { Browser, Dialog, Locator, Page } from 'playwright-core'
import { configDir, readConfig } from 'neorouter'
import { cancels, changes, cutOff, describeAction, find, focused, pageAnswer, pageLines, textLines, window, type Action } from './page.ts'

export type { Action } from './page.ts'

/**
 * navi's own browser (browser.md): one Chromium with its own profile, shared
 * by every navi on the computer over its debugging port, a tab per session.
 * Playwright is loaded only when a browser tool is first used.
 */

/** One session's tabs, as the browser tools use them: actions land in the current one. */
export interface Tab {
  /** In the current tab, or a new one that becomes current (BRW-14). */
  /** `saveIn`: where a download it starts is kept (BRW-20). */
  open: (url: string, o?: { newTab?: boolean; saveIn?: string }) => Promise<string>
  /** The session's tabs, the current one marked (BRW-14). */
  tabs: () => Promise<string>
  /** Makes a tab current and reads it (BRW-14). */
  switchTo: (id: string) => Promise<string>
  /** Closes one of the session's own tabs (BRW-14). */
  close: (id: string) => Promise<string>
  read: (o: { offset?: number; find?: string }) => Promise<string>
  back: () => Promise<string>
  /** The one line approval shows (BRW-11), or why the action cannot be done. */
  describe: (action: Action) => Promise<{ line: string; url: string } | { problem: string }>
  /**
   * Does it, and says what changed (BRW-10), but only while the page still
   * describes it as `approved`.
   */
  act: (action: Action, approved: { line: string; url: string }, saveIn?: string) => Promise<string>
  /**
   * Runs `fn` with the tab to itself (BRW-11): nothing else the session does
   * in the tab runs between an action's description, its approval and its
   * doing. `fn` gets a tab that is not locked again.
   */
  lock: <T>(fn: (tab: Tab) => Promise<T>) => Promise<T>
  /** The current tab as the user would see it, a JPEG (PSH-17); it changes nothing, so it waits on no lock. */
  shot: () => Promise<Buffer>
  /** The current tab's URL and a picture of it, for the model (BRW-18). */
  look: () => Promise<{ url: string; jpeg: Buffer }>
}

export interface BrowserOptions {
  /** Whose `~/.neoai/browser` holds the profile. */
  home: string
  /** Overrides `"browser": { "executable" }` in the home's config (BRW-4). */
  executable?: string
  /** For tests: no window. */
  headless?: boolean
  /** For tests: how long attaching to a running browser may take before it is taken for stuck (BRW-16); one just started gets the usual time. */
  attachMs?: number
  /** For tests: how long a page may take to load (BRW-6). */
  loadMs?: number
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
/** How long an action itself may take. */
const ACT_MS = 5000

export const profileDir = (home: string) => join(home, '.neoai', 'browser', 'profile')

const exists = (path: string) => access(path).then(() => true, () => false)

const playwright = () => import('playwright-core').then((m) => m.chromium)

/** `"browser": { "executable" }` in the home's `~/.neoai/config.json`, when it names one (BRW-4). */
export async function configuredBrowser(home: string): Promise<string | undefined> {
  const config = await readConfig(configDir(home)).catch(() => ({}) as Record<string, any>)
  return typeof config.browser?.executable === 'string' ? config.browser.executable : undefined
}

/** Which browser to start (BRW-4), or null when there is none. A configured one must exist. */
export async function findBrowser(executable?: string): Promise<string | null> {
  if (executable) {
    if (await exists(executable)) return executable
    throw new Error(`"browser": { "executable" } in ~/.neoai/config.json names ${executable}, which does not exist.`)
  }
  const installed = (await playwright()).executablePath()
  if (installed && (await exists(installed))) return installed
  return (await exists(CHROME)) ? CHROME : null
}

export const NO_BROWSER = 'There is no browser for navi yet. The user can install one with `navi browser --install`.'

/** Whether a browser answers on the port: a busy one may be slow to, so it is asked twice. */
async function answers(port: number): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) }).then(
      (r) => r.ok,
      () => false,
    )
    if (ok) return true
  }
  return false
}

/**
 * One navi at a time decides whether to start the browser, so two starting
 * together do not each start one (BRW-3). A lock left by a navi that died is
 * taken over after a while.
 */
async function locked<T>(profile: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${profile}.lock`
  await mkdir(dirname(lock), { recursive: true })
  for (let waited = 0; ; waited += 100) {
    const took = await mkdir(lock).then(() => true, () => false)
    if (took) break
    const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0)
    if (age > 30_000) await rm(lock, { recursive: true, force: true })
    else await new Promise((r) => setTimeout(r, 100))
  }
  try {
    return await fn()
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

/** Starts the browser on its own, to outlive navi (BRW-2), and returns its debugging port. */
async function launch(exe: string, profile: string, headless: boolean): Promise<number> {
  await mkdir(profile, { recursive: true })
  // Only ever a file left by a browser that is gone: one that answers is attached to instead.
  await rm(join(profile, 'DevToolsActivePort'), { force: true })
  const args = [
    `--user-data-dir=${profile}`,
    // Chosen by the browser and written to the profile; loopback only (BRW-3).
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    // A test's browser leaves the keychain alone: under a home of its own, Chrome waits on it and loads nothing.
    ...(headless ? ['--headless=new', '--use-mock-keychain'] : []),
    'about:blank',
  ]
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref()
  for (let waited = 0; waited < 15_000; waited += 100) {
    const port = await debugPort(profile)
    if (port) return port
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the browser did not start')
}

/** The port a running browser on this profile listens on, from the file it writes. */
async function debugPort(profile: string): Promise<number | null> {
  const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')
  const port = Number(text.split('\n')[0])
  return Number.isInteger(port) && port > 0 ? port : null
}

/** How long attaching to a running browser may take before it is taken for stuck (BRW-16). */
const ATTACH_MS = 15_000

/**
 * Closes a browser on this profile that answers but will not be attached to
 * (BRW-16): asked over DevTools first, then ended, only when the process the
 * profile's lock names is one running on this profile.
 */
async function closeStuck(port: number, profile: string): Promise<void> {
  try {
    const { webSocketDebuggerUrl: url } = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json()) as { webSocketDebuggerUrl: string }
    await new Promise<void>((done) => {
      const ws = new WebSocket(url)
      let ended = false
      // Closing fires onclose, which would end again.
      const end = () => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        ws.close()
        done()
      }
      const timer = setTimeout(end, 3000)
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
      ws.onmessage = ws.onerror = ws.onclose = end
    })
  } catch {
    // Not asked; ended below if it stays.
  }
  const gone = async () => {
    for (let waited = 0; waited < 5000; waited += 250) {
      if (!(await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok, () => false))) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }
  if (await gone()) return
  // The lock is a link to "<host>-<pid>".
  const pid = Number((await readlink(join(profile, 'SingletonLock')).catch(() => '')).split('-').pop())
  if (!Number.isInteger(pid) || pid <= 0) return
  const command = await new Promise<string>((r) => execFile('ps', ['-o', 'command=', '-p', String(pid)], (_e, out) => r(String(out ?? ''))))
  if (!command.includes(`--user-data-dir=${profile}`)) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }
  await gone()
}

/** The blank tab a browser this process started opened with, until a session takes it. */
const spare = new WeakSet<Page>()

/** A tab of navi's own: the spare blank one, else a new one. */
async function newTab(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const blank = context.pages().find((p) => spare.has(p) && !p.isClosed() && p.url() === 'about:blank')
  if (blank) {
    spare.delete(blank)
    return blank
  }
  return context.newPage()
}

/** Connections by profile: a process holds one, whatever its sessions. */
const connections = new Map<string, Promise<Browser>>()

/** The running browser, started first when there is none (BRW-2, BRW-3). */
export async function connect(o: BrowserOptions): Promise<Browser> {
  const profile = profileDir(o.home)
  const held = connections.get(profile)
  if (held) {
    const b = await held.catch(() => null)
    if (b?.isConnected()) return b
    connections.delete(profile)
  }
  const made = (async () => {
    const chromium = await playwright()
    const attach = (port: number, ms = ATTACH_MS) => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: ms })
    return locked(profile, async () => {
      // Read under the lock: another navi may have just started it.
      const port = await debugPort(profile)
      // A browser that answers is the one to use, unless it will not be attached to (BRW-16).
      if (port && (await answers(port))) {
        try {
          return await attach(port, o.attachMs)
        } catch {
          await closeStuck(port, profile)
        }
      }
      const exe = await findBrowser(o.executable ?? (await configuredBrowser(o.home)))
      if (!exe) throw new Error(NO_BROWSER)
      const b = await attach(await launch(exe, profile, o.headless ?? false))
      // The blank tab it starts with is the first one asked for, not left beside it.
      const first = b.contexts()[0]?.pages()[0]
      if (first?.url() === 'about:blank') spare.add(first)
      return b
    })
  })()
  connections.set(profile, made)
  made.catch(() => connections.delete(profile))
  return made
}

/** Lets go of the browser, leaving it running (BRW-2): what a process does on its way out. */
export async function disconnect(home: string): Promise<void> {
  const held = connections.get(profileDir(home))
  connections.delete(profileDir(home))
  const b = await held?.catch(() => null)
  // Over CDP, close() drops the connection; the browser itself stays.
  await b?.close().catch(() => {})
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]

/** Reading a page as elements past this, it is read as text (BRW-5). */
const SNAPSHOT_MS = 10_000

/**
 * Chrome cannot hand back a tree much deeper than this (its encoder gives
 * up, and Playwright retries until it times out), so a page is read this
 * deep and each part cut off is read on its own, at most PARTS of them.
 */
const DEPTH = 40
const PARTS = 300

const read = (where: Page | Locator) => where.ariaSnapshot({ mode: 'ai', depth: DEPTH, timeout: 3000 } as never)

/** The page as Playwright's snapshot, however deeply nested (BRW-5). */
async function snapshot(page: Page): Promise<string> {
  const until = Date.now() + SNAPSHOT_MS
  const top = await read(page)
  const left = { parts: PARTS, until }
  const whole = await deepen(page, top, left)
  // A ref is looked up in the latest snapshot only, which a part's replaced: read the whole page last again.
  if (left.parts < PARTS) await read(page)
  return whole
}

let parts = 0

/** A snapshot with each part its depth limit cut off read on its own and put back in place. */
async function deepen(page: Page, text: string, left: { parts: number; until: number }): Promise<string> {
  const lines = text.split('\n')
  const cut = lines.flatMap((l, i) => {
    const ref = cutOff(l, DEPTH)
    return ref ? [{ i, ref }] : []
  })
  if (!cut.length) return text
  // Each part's element first: the next snapshot replaces the one its ref is looked up in.
  const handles = await Promise.all(cut.map((c) => page.locator(`aria-ref=${c.ref}`).elementHandle({ timeout: 1000 }).catch(() => null)))
  for (const [k, c] of cut.entries()) {
    const handle = handles[k]
    if (!handle) continue
    try {
      const frame = await handle.ownerFrame()
      if (!frame || left.parts <= 0 || Date.now() > left.until) continue
      left.parts--
      // Found again by a mark of navi's own, taken off once read.
      const mark = `p${++parts}`
      await handle.evaluate((e, m) => (e as unknown as { setAttribute: (a: string, v: string) => void }).setAttribute('data-navi-part', m), mark)
      const part = await read(frame.locator(`[data-navi-part="${mark}"]`)).finally(() =>
        handle.evaluate((e) => (e as unknown as { removeAttribute: (a: string) => void }).removeAttribute('data-navi-part')).catch(() => {}),
      )
      const pad = /^\s*/.exec(lines[c.i])![0]
      lines[c.i] = (await deepen(page, part, left)).split('\n').map((l) => pad + l).join('\n')
    } catch {
      // A part that cannot be read is left as its one line.
    } finally {
      await handle.dispose().catch(() => {})
    }
  }
  return lines.join('\n')
}

/** Whatever a page runs, given up on after `ms`: one that never loaded never runs it (BRW-17). */
const within = <T>(ms: number, run: Promise<T>) =>
  Promise.race([run, new Promise<never>((_, no) => setTimeout(() => no(new Error(`Timeout ${ms}ms: the page did not answer`)), ms).unref())])

/** Pages found too complex, by the URL they were found at: read as text until they move on, not waited on again. */
const complex = new WeakMap<Page, string>()

/** The page's lines now (BRW-5), or its plain text when it cannot be read as elements. */
async function linesOf(page: Page): Promise<string[]> {
  try {
    if (complex.get(page) === page.url()) throw new Error('Timeout: known too complex')
    return pageLines(await snapshot(page))
  } catch (e) {
    if (!/Timeout/.test(reason(e))) throw e
    const text = await within(3000, page.evaluate<string>("document.body?.innerText ?? ''")).catch(() => null)
    // BRW-17: a page that never loaded has nothing to read yet, and is not waited on.
    if (text === null) return ['(the page has not finished loading; read it again in a moment, or open it again)']
    complex.set(page, page.url())
    return textLines(text)
  }
}

/**
 * Resolves once the page is quiet: 300ms with nothing added, removed or
 * changed, and nothing marked busy or saying it is loading; 1.5s at most.
 * A string, as the page runs it: functions compiled for tests carry helpers
 * the page does not have.
 */
const QUIET = `new Promise((done) => {
  const loading = () => !!document.querySelector('[aria-busy=true]') || /\\bloading\\b/i.test(document.body?.innerText ?? '')
  const finish = () => { watch.disconnect(); clearTimeout(timer); clearTimeout(limit); done() }
  const quiet = () => { if (loading()) timer = setTimeout(quiet, 100); else finish() }
  let timer = setTimeout(quiet, 300)
  const limit = setTimeout(finish, 1500)
  const watch = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(quiet, 300) })
  watch.observe(document, { childList: true, subtree: true, characterData: true, attributes: true })
})`

/**
 * Waits for what an action set going, at most 5s (BRW-9): the page loaded,
 * the network quiet, and the page no longer changing, so a page drawn by
 * scripts is read once drawn. A page that never goes quiet is read as it is.
 */
async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {})
  await within(2000, page.evaluate(QUIET)).catch(() => {})
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** A session's tabs, the first opened when first used (BRW-2, BRW-14). */
/** The most a download may hold, and how long it may take (BRW-20). */
const DOWNLOAD_MAX = 200 * 1024 * 1024
const DOWNLOAD_MS = 60_000

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** A name in `dir` nothing has yet: `name`, else `stem (2).ext` and on. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n++) {
    const at = join(dir, n === 1 ? name : `${stem} (${n})${ext}`)
    if (!(await lstat(at).catch(() => null))) return at
  }
}

/** A download the browser began: its name, and how it ended. */
interface Begun {
  guid: string
  name: string
  ended: Promise<'completed' | 'canceled'>
}

/**
 * Runs `fn` with downloads let through into `stage` and told of (BRW-20),
 * then puts the browser back as it was, so downloads the user makes in the
 * window go where they always do.
 */
const catchers = new Map<Browser, number>()

async function catchingDownloads<T>(
  browser: Browser,
  stage: string,
  fn: (began: (ms: number) => Promise<void>) => Promise<T>,
): Promise<{ result: T; begun: Begun[] }> {
  await mkdir(stage, { recursive: true })
  const cdp = await browser.newBrowserCDPSession()
  const begun: Begun[] = []
  const ends = new Map<string, (state: 'completed' | 'canceled') => void>()
  let first: () => void = () => {}
  const firstBegun = new Promise<void>((r) => (first = r))
  cdp.on('Browser.downloadWillBegin', (e) => {
    begun.push({ guid: e.guid, name: e.suggestedFilename, ended: new Promise((done) => ends.set(e.guid, done)) })
    first()
  })
  // Waits, at most `ms`, for a download to begin.
  const began = (ms: number) => within(ms, firstBegun).catch(() => {})
  cdp.on('Browser.downloadProgress', (e) => {
    if (e.state !== 'inProgress') ends.get(e.guid)?.(e.state)
  })
  catchers.set(browser, (catchers.get(browser) ?? 0) + 1)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: stage, eventsEnabled: true })
  try {
    const result = await fn(began)
    await Promise.all(begun.map((d) => within(DOWNLOAD_MS, d.ended).catch(() => {})))
    return { result, begun }
  } finally {
    // Put back only once no other session of this process is catching too.
    const left = (catchers.get(browser) ?? 1) - 1
    if (left) catchers.set(browser, left)
    else {
      catchers.delete(browser)
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {})
    }
    await cdp.detach().catch(() => {})
  }
}

/** Each download kept in `dir`, said in a line (BRW-20); nothing ever overwritten. */
async function keepDownloads(begun: Begun[], stage: string, dir: string | undefined): Promise<string> {
  const said: string[] = []
  for (const d of begun) {
    const name = basename(d.name.replace(/\\/g, '/')).replace(/[\x00-\x1f:]/g, '_') || 'download'
    const staged = join(stage, d.guid)
    const state = await Promise.race([d.ended, new Promise<'late'>((r) => setTimeout(() => r('late'), 0))])
    try {
      if (state === 'late') said.push(`A download of ${name} did not finish within 60s, so it was not kept.`)
      else if (state === 'canceled') said.push(`A download of ${name} was cancelled.`)
      else if (!dir) said.push(`It downloaded ${name}, which was not kept: there is nowhere to keep it.`)
      else {
        const bytes = (await stat(staged)).size
        if (bytes > DOWNLOAD_MAX) said.push(`It downloaded ${name}, ${size(bytes)}: over 200 MB, so it was not kept.`)
        else {
          const at = await freeName(dir, name)
          await copyFile(staged, at)
          said.push(`It downloaded ${name} (${size(bytes)}), saved as ${at}.`)
        }
      }
    } catch (e) {
      said.push(`A download of ${name} could not be kept: ${reason(e)}.`)
    } finally {
      await rm(staged, { force: true })
    }
  }
  return said.join('\n')
}

export function makeTab(o: BrowserOptions): Tab {
  /** The session's own tabs, by id, in the order opened. */
  const owned: { id: string; page: Page }[] = []
  let current: Page | null = null
  let count = 0
  /** Tabs pages opened themselves since the last action began (BRW-15). */
  let popped: Page[] = []
  /** BRW-21: the answer the action being done gives a pop-up, what pop-ups said since the last result, and each page's last question. */
  let reply: string | undefined
  let said: string[] = []
  const asked = new WeakMap<Page, string>()
  // BRW-20: where downloads wait before they are kept.
  const stage = join(o.home, '.neoai', 'browser', 'downloads')
  const catching = async <T>(fn: (began: (ms: number) => Promise<void>) => Promise<T>) => catchingDownloads(await connect(o), stage, fn)

  const alive = (p: Page) => !p.isClosed() && !!p.context().browser()?.isConnected()

  /** Takes a page as the session's, with the tabs it opens in turn. */
  const adopt = (page: Page) => {
    owned.push({ id: `t${++count}`, page })
    page.on('popup', (opened) => {
      adopt(opened)
      popped.push(opened)
    })
    page.on('dialog', (d) => void popUp(page, d))
    return page
  }

  /** BRW-21: a pop-up answered at once, so the tab never hangs on it, and told with the next result. */
  const popUp = async (page: Page, d: Dialog) => {
    const words = d.type() === 'beforeunload' ? 'Leave this page? Changes on it may not be saved.' : d.message()
    const quoted = JSON.stringify(words.replace(/\s+/g, ' ').trim().slice(0, 300))
    if (d.type() === 'alert') {
      said.push(`The page showed a message: ${quoted}`)
      return d.accept().catch(() => {})
    }
    if (reply === undefined || cancels(reply)) {
      asked.set(page, words.replace(/\s+/g, ' ').trim().slice(0, 300))
      const how = d.type() === 'prompt' ? 'with dialog set to the text to give' : 'with dialog "ok"'
      said.push(`The page asked ${quoted} and it was answered Cancel${reply === undefined ? `, so what it asked about was likely not done. If it should be, do the same action again ${how}.` : ', as asked.'}`)
      return d.dismiss().catch(() => {})
    }
    asked.delete(page)
    const given = d.type() === 'prompt' ? reply : undefined
    said.push(`The page asked ${quoted}; it was answered ${given === undefined ? 'OK' : JSON.stringify(given)}.`)
    return d.accept(given).catch(() => {})
  }
  /** A result, after what pop-ups said on the way to it. */
  const told = (result: string) => {
    const before = said
    said = []
    return before.length ? `${before.join('\n')}\n${result}` : result
  }
  const idOf = (p: Page) => owned.find((t) => t.page === p)?.id ?? '?'
  const live = () => owned.filter((t) => alive(t.page))

  const tab = async (): Promise<Page> => {
    if (current && alive(current)) return current
    current = adopt(await newTab(await connect(o)))
    return current
  }

  /** A page as an answer, naming its tab once the session has more than one. */
  const answer = async (p: Page) => {
    const text = pageAnswer(await p.title().catch(() => ''), p.url(), await linesOf(p))
    return live().length > 1 ? `[tab ${idOf(p)}] ${text}` : text
  }

  /** The page without its fragment: a jump within it is the same page. */
  const where = (p: Page) => p.url().replace(/#.*$/, '')

  /**
   * The action as approval words it, read from the page now: the element by
   * its ref, the frame it is in, where a link goes, and what has focus.
   */
  const description = async (p: Page, action: Action) => {
    if (complex.get(p) === p.url()) throw new Error('Timeout: known too complex')
    const raw = await snapshot(p)
    const host = hostOf(p.url())
    const extra: { frame?: string; goes?: string } = {}
    if ('ref' in action) {
      const handle = await p.locator(`aria-ref=${action.ref}`).elementHandle({ timeout: 2000 }).catch(() => null)
      const frame = await handle?.ownerFrame()
      if (frame && frame !== p.mainFrame() && hostOf(frame.url()) !== host) extra.frame = hostOf(frame.url()) || frame.url()
      // Written without DOM types, which not every package that type-checks this has.
      const href = await handle
        ?.evaluate((e) => {
          const a = e as unknown as { tagName: string; href?: unknown }
          return a.tagName === 'A' && typeof a.href === 'string' ? a.href : ''
        })
        .catch(() => '')
      const goes = href ? hostOf(href) : ''
      if (goes && goes !== (extra.frame ?? host)) extra.goes = goes
      await handle?.dispose()
    }
    const line = describeAction(action, pageLines(raw), { host, focus: focused(raw), asked: asked.get(p), ...extra })
    return line ? { line, url: p.url() } : null
  }

  const unlocked: Tab = {
    open: async (url, { newTab: fresh, saveIn } = {}) => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return `${url} is not a URL; give a full http or https address.`
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `Only http and https pages are opened, not ${parsed.protocol}`
      try {
        // A new tab only once there is a first one; the first is new anyway.
        const p = fresh && current && alive(current) ? (current = adopt(await newTab(await connect(o)))) : await tab()
        // A link to a file downloads it rather than loading a page (BRW-20).
        const { result: failed, begun } = await catching((began) =>
          p.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout: o.loadMs ?? 30_000 }).then(
            () => null,
            // The browser says so before it says what it is downloading.
            async (e: unknown) => (/Download is starting/.test(reason(e)) && (await began(3000)), e),
          ),
        )
        if (begun.length) return await keepDownloads(begun, stage, saveIn)
        if (failed) throw failed
        await settle(p)
        return await answer(p)
      } catch (e) {
        return `could not open ${url}: ${reason(e)}`
      }
    },
    tabs: async () => {
      const tabs = live()
      if (!tabs.length) return 'No tabs are open yet; browser_open opens one.'
      const lines = await Promise.all(
        tabs.map(async (t) => `${t.page === current ? '*' : ' '} ${t.id}  ${(await t.page.title().catch(() => '')) || '(no title)'} — ${t.page.url()}`),
      )
      return `${lines.join('\n')}\n(* is the current tab, where actions land)`
    },
    switchTo: async (id) => {
      const t = live().find((t) => t.id === id)
      if (!t) return `There is no open tab ${id}; browser_tabs lists them.`
      current = t.page
      await t.page.bringToFront().catch(() => {})
      return answer(t.page)
    },
    close: async (id) => {
      const t = live().find((t) => t.id === id)
      if (!t) return `There is no open tab ${id}; browser_tabs lists them.`
      await t.page.close()
      if (current === t.page) current = live().at(-1)?.page ?? null
      return current ? `Closed ${id}; the current tab is ${idOf(current)}.` : `Closed ${id}; no tabs are open.`
    },
    read: async ({ offset, find: text }) => {
      try {
        const p = await tab()
        const lines = await linesOf(p)
        return text ? find(lines, text) : `${p.url()}\n\n${window(lines, offset)}`
      } catch (e) {
        return `could not read the page: ${reason(e)}`
      }
    },
    back: async () => {
      try {
        const p = await tab()
        // A page restored from the back-forward cache never loads again; committing is enough.
        // Restored from the cache, a page has no response to return, so the address tells.
        const from = p.url()
        await p.goBack({ waitUntil: 'commit', timeout: o.loadMs ?? 30_000 })
        if (p.url() === from) return 'There is no page to go back to.'
        await settle(p)
        return await answer(p)
      } catch (e) {
        return `could not go back: ${reason(e)}`
      }
    },
    describe: async (action) => {
      try {
        // Read now, so the ref is looked up on the page as it is (and Playwright knows it).
        const d = await description(await tab(), action)
        return d ?? { problem: `No element [ref=${'ref' in action ? action.ref : ''}] is on the page now; read the page again.` }
      } catch (e) {
        if (/Timeout/.test(reason(e))) return { problem: 'This page is too complex to read as elements in time, so nothing on it can be acted on by ref.' }
        return { problem: `could not read the page: ${reason(e)}` }
      }
    },
    act: async (action, approved, saveIn) => {
      try {
        const p = await tab()
        // Looked at again just before acting: the ref must still name what was
        // approved, on the page it was approved on, or nothing is done.
        const now = await description(p, action)
        if (!now || now.line !== approved.line || now.url !== approved.url)
          return 'The page changed since the action was approved; nothing was done. Read the page again.'
        const before = await linesOf(p)
        const url = where(p)
        popped = []
        // A tab a click opens arrives a moment after the click: waited for briefly, alongside settling.
        const mayOpen = action.kind === 'click' || action.kind === 'press' || (action.kind === 'type' && action.submit)
        const opening = mayOpen ? p.waitForEvent('popup', { timeout: 600 }).catch(() => null) : null
        const target = 'ref' in action ? p.locator(`aria-ref=${action.ref}`) : null
        reply = 'dialog' in action ? action.dialog : undefined
        const { begun } = await catching(async () => {
          if (action.kind === 'click') await target!.click({ timeout: ACT_MS })
          else if (action.kind === 'type') {
            await target!.fill(action.text, { timeout: ACT_MS })
            if (action.submit) await target!.press('Enter', { timeout: ACT_MS })
          }
          // By the label the user sees only: a value can stand behind a different label.
          else if (action.kind === 'select') await target!.selectOption({ label: action.option }, { timeout: ACT_MS })
          // BRW-19: a file field takes the file itself; anything else, by the chooser its click opens.
          else if (action.kind === 'upload') {
            const field = await target!.evaluate((e) => (e as unknown as { type?: string; tagName: string }).tagName === 'INPUT' && (e as unknown as { type?: string }).type === 'file', undefined, { timeout: ACT_MS })
            if (field) await target!.setInputFiles(action.path, { timeout: ACT_MS })
            else {
              const chooser = p.waitForEvent('filechooser', { timeout: ACT_MS })
              await target!.click({ timeout: ACT_MS })
              await (await chooser).setFiles(action.path)
            }
          }
          else await p.keyboard.press(action.key)
          await Promise.all([settle(p), opening])
        }).finally(() => (reply = undefined))
        const got = begun.length ? `\n${await keepDownloads(begun, stage, saveIn)}` : ''
        // A tab the page opened becomes current: it is what the action led to (BRW-15).
        const opened = popped.filter(alive).at(-1)
        if (opened) {
          current = opened
          await settle(opened)
          return `It opened a new tab, ${idOf(opened)}, now the current one.\n${await answer(opened)}${got}`
        }
        if (where(p) !== url) return `${await answer(p)}${got}`
        return `${changes(before, await linesOf(p))}${got}`
      } catch (e) {
        return `could not ${action.kind}: ${reason(e)}`
      }
    },
    lock: (fn) => fn(unlocked),
    shot: async () => (await tab()).screenshot({ type: 'jpeg', quality: 60, timeout: 10_000 }),
    look: async () => {
      const p = await tab()
      return { url: p.url(), jpeg: await p.screenshot({ type: 'jpeg', quality: 60, timeout: 10_000 }) }
    },
  }

  // BRW-21: each result that reads the page carries what its pop-ups said on the way, lock or not.
  const bare = { ...unlocked }
  unlocked.open = (url, o) => bare.open(url, o).then(told)
  unlocked.switchTo = (id) => bare.switchTo(id).then(told)
  unlocked.read = (o) => bare.read(o).then(told)
  unlocked.back = () => bare.back().then(told)
  unlocked.act = (a, approved, saveIn) => bare.act(a, approved, saveIn).then(told)

  // One thing at a time in the tab: the model may ask for several at once.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn)
    queue = run.catch(() => {})
    return run
  }
  return {
    open: (url, o) => serial(() => unlocked.open(url, o)),
    tabs: () => serial(() => unlocked.tabs()),
    switchTo: (id) => serial(() => unlocked.switchTo(id)),
    close: (id) => serial(() => unlocked.close(id)),
    read: (o) => serial(() => unlocked.read(o)),
    look: () => serial(() => unlocked.look()),
    back: () => serial(() => unlocked.back()),
    describe: (a) => serial(() => unlocked.describe(a)),
    act: (a, approved, saveIn) => serial(() => unlocked.act(a, approved, saveIn)),
    lock: (fn) => serial(() => fn(unlocked)),
    // Asked for while an action awaits approval, with the tab held: it must not queue behind that.
    shot: () => unlocked.shot(),
  }
}

/** Quits the browser: for tests only, since navi never closes the user's window (BRW-2). */
export async function quitBrowser(home: string): Promise<void> {
  const held = connections.get(profileDir(home))
  connections.delete(profileDir(home))
  const b = await held?.catch(() => null)
  if (!b?.isConnected()) return
  const cdp = await b.newBrowserCDPSession()
  await cdp.send('Browser.close').catch(() => {})
}

/** Opens the window on a new tab, for signing in (BRW-12). */
export async function showBrowser(o: BrowserOptions, url = 'about:blank'): Promise<void> {
  const page = await newTab(await connect(o))
  if (url !== 'about:blank') await page.goto(url).catch(() => {})
  await page.bringToFront()
}

/** Installs or updates the Chromium navi uses, with Playwright's own installer (BRW-12). */
export function installBrowser(): Promise<boolean> {
  const require = createRequire(import.meta.url)
  const cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js')
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}
