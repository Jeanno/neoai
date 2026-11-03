import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveMcp, type Ask } from '../src/mcp.ts'
import type { Tab } from '../src/browser.ts'

/** Sends lines to a server and collects every reply once input ends. */
async function exchange(lines: unknown[], ask: Ask = async ({ prompt }) => ({ text: `did: ${prompt}`, model: 'm on Box' }), browser?: () => Tab) {
  const input = new PassThrough()
  const output = new PassThrough()
  const out: string[] = []
  output.on('data', (c) => out.push(String(c)))
  const done = serveMcp(ask, { input, output, cwd: '/work', ...(browser && { browser }) })
  for (const l of lines) input.write(typeof l === 'string' ? `${l}\n` : `${JSON.stringify(l)}\n`)
  input.end()
  await done
  return out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

const call = (id: number, args: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'ask_navi', arguments: args } })

// MCP-1
test('answers initialize, ping and tools/list, and nothing for a notification', async () => {
  const replies = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    { jsonrpc: '2.0', id: 4, method: 'resources/list' },
    'not json',
  ])
  assert.equal(replies.length, 5)
  assert.equal(replies[0].result.protocolVersion, '2025-03-26')
  assert.deepEqual(replies[0].result.capabilities, { tools: {} })
  assert.deepEqual(replies[1], { jsonrpc: '2.0', id: 2, result: {} })
  assert.deepEqual(replies[2].result.tools.map((t: any) => t.name), ['ask_navi'])
  assert.equal(replies[3].error.code, -32601)
  assert.equal(replies[4].error.code, -32700)
})

// MCP-2, MCP-3
test('ask_navi runs a turn in the directory and names the model', async () => {
  const seen: any[] = []
  const [r] = await exchange([call(1, { prompt: 'list it', directory: '/proj' })], async (o) => {
    seen.push(o)
    return { text: 'two files', model: 'qwen on Darkbloom' }
  })
  assert.deepEqual(seen, [{ prompt: 'list it', directory: '/proj', attachments: [] }])
  assert.deepEqual(r.result, { content: [{ type: 'text', text: 'two files\n\n— answered by qwen on Darkbloom' }] })
})

test('the server directory is the default, and files are attached from the directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-mcp-'))
  await writeFile(join(dir, 'n.md'), 'note')
  const seen: any[] = []
  await exchange([call(1, { prompt: 'p' }), call(2, { prompt: 'q', directory: dir, files: ['n.md'] })], async (o) => {
    seen.push(o)
    return { text: '', model: '' }
  })
  assert.equal(seen.find((o) => o.prompt === 'p').directory, '/work')
  assert.deepEqual(seen.find((o) => o.prompt === 'q').attachments, [{ kind: 'text', name: 'n.md', text: 'note' }])
})

// MCP-3
test('a failure is a tool result with isError, not a protocol error', async () => {
  const replies = await exchange(
    [call(1, { prompt: 'x' }), call(2, { prompt: '' }), call(3, { prompt: 'x', directory: 'rel' }), call(4, { prompt: 'x', files: ['/nope.png'] })],
    async () => {
      throw new Error('navi has no model to answer with: primary (local): no local model server is running')
    },
  )
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]))
  assert.equal(byId[1].result.isError, true)
  assert.match(byId[1].result.content[0].text, /no local model server is running/)
  assert.match(byId[2].result.content[0].text, /prompt is required/)
  assert.match(byId[3].result.content[0].text, /must be an absolute path/)
  assert.match(byId[4].result.content[0].text, /nope\.png: no such file/)
})

// MCP-5
test('a slow call does not hold up a ping', async () => {
  let release = () => {}
  const replies = await exchange(
    [call(1, { prompt: 'slow' }), { jsonrpc: '2.0', id: 2, method: 'ping' }],
    () =>
      new Promise((resolve) => {
        release = () => resolve({ text: 'late', model: 'm' })
        setTimeout(release, 50)
      }),
  )
  assert.deepEqual(replies.map((r) => r.id), [2, 1])
})

/** A browser tab that answers in words and records what was done. */
function fakeTab() {
  const done: string[] = []
  let made = 0
  const tab: Tab = {
    open: async (url) => `opened ${url}`,
    tabs: async () => '* t1',
    switchTo: async (id) => `switched to ${id}`,
    close: async (id) => `closed ${id}`,
    read: async () => 'the page',
    back: async () => 'went back',
    hover: async (ref) => `hovered ${ref}`,
    describe: async (a: any) => ({ line: `click ${a.ref} on shop.test`, url: 'https://shop.test/' }),
    act: async (a: any, approved) => (done.push(`${a.ref}: ${approved.line}`), `clicked ${a.ref}`),
    lock: (fn) => fn(tab),
    shot: async () => Buffer.from('a jpeg'),
    look: async () => ({ url: 'https://shop.test/', jpeg: Buffer.from('a jpeg') }),
  }
  return { tab, done, made: () => made, make: () => (made++, tab) }
}

// MCP-6, MCP-7
test('with --browser, the browser tools are served, marked, and acted on by the client\'s say-so', async () => {
  const f = fakeTab()
  const browse = (id: number, name: string, args: unknown = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  const replies = await exchange(
    [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      browse(2, 'browser_open', { url: 'https://shop.test/' }),
      browse(3, 'browser_click', { ref: 'Buy' }),
      browse(4, 'browser_look'),
    ],
    undefined,
    f.make,
  )
  const tools = Object.fromEntries(replies[0].result.tools.map((t: any) => [t.name, t]))
  assert.ok(tools.ask_navi && !tools.ask_navi.annotations)
  assert.deepEqual(Object.keys(tools).filter((n) => n.startsWith('browser_')).sort(), [
    'browser_back', 'browser_click', 'browser_close_tab', 'browser_hover', 'browser_look', 'browser_open', 'browser_press', 'browser_read',
    'browser_select', 'browser_switch', 'browser_tabs', 'browser_type', 'browser_upload',
  ])
  assert.deepEqual(tools.browser_read.annotations, { readOnlyHint: true, destructiveHint: false })
  assert.deepEqual(tools.browser_click.annotations, { readOnlyHint: false, destructiveHint: true })
  // BRW-22: a hover presses nothing.
  assert.deepEqual(tools.browser_hover.annotations, { readOnlyHint: true, destructiveHint: false })
  assert.equal(tools.browser_click.inputSchema.type, 'object')
  assert.deepEqual(tools.browser_click.inputSchema.required, ['ref'])
  const byId = Object.fromEntries(replies.map((r: any) => [r.id, r.result]))
  assert.deepEqual(byId[2], { content: [{ type: 'text', text: 'opened https://shop.test/' }] })
  assert.deepEqual(byId[3], { content: [{ type: 'text', text: 'clicked Buy' }] })
  assert.deepEqual(f.done, ['Buy: click Buy on shop.test'])
  assert.deepEqual(byId[4].content, [
    { type: 'text', text: 'The page as it looks now: https://shop.test/' },
    { type: 'image', data: Buffer.from('a jpeg').toString('base64'), mimeType: 'image/jpeg' },
  ])
  assert.equal(f.made(), 1, 'one session for every call')
})

