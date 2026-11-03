import { createInterface } from 'node:readline'
import { isAbsolute } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import { attach, type Attachment } from './attach.ts'
import type { Tab } from './browser.ts'
import { makeTools } from './tools.ts'

/** What answering one `ask_navi` call takes; the real harness by default, a fake in tests. */
export type Ask = (o: { prompt: string; directory: string; attachments: Attachment[] }) => Promise<{ text: string; model: string }>

const TOOL = {
  name: 'ask_navi',
  description:
    "Hand a task to navi, a local agent running the user's own model. It can search and read files, " +
    'search the web, and run commands or create files it judges safe, in the directory given. ' +
    'Returns its answer.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What navi should do or answer.' },
      directory: { type: 'string', description: 'Absolute path navi works in. Defaults to where the server runs.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Images, PDFs or text files to attach.' },
    },
    required: ['prompt'],
  },
}

/** Browser tools that only look, which a client may run unasked (MCP-6). */
const READ_ONLY = new Set(['browser_open', 'browser_read', 'browser_tabs', 'browser_switch', 'browser_back', 'browser_look', 'browser_hover'])

interface Served {
  name: string
  description: string
  inputSchema: object
  annotations: { readOnlyHint: boolean; destructiveHint: boolean }
  run: (args: Record<string, unknown>) => Promise<object>
}

/**
 * navi's browser tools as MCP tools (MCP-6): one session's tabs for every
 * call, and the client's approval as the only one.
 */
export function browserTools(tab: () => Tab, cwd: string): Served[] {
  let held: Tab | undefined
  const browser = () => (held ??= tab())
  // The client asked its user before calling: that is the yes.
  // Only the browser tools are served: nothing else is run, so nothing else is approved.
  const tools = makeTools({ approve: async () => false, act: async () => true }, { browser, cwd, write: false, fetch: false })
  return Object.entries(tools)
    .filter(([name]) => name.startsWith('browser_'))
    .map(([name, t]: [string, any]) => ({
      name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.inputSchema),
      annotations: { readOnlyHint: READ_ONLY.has(name), destructiveHint: !READ_ONLY.has(name) },
      run: async (args) => {
        const out = await t.execute(args, { toolCallId: name, messages: [] })
        if (typeof out === 'string') return text(out)
        // MCP-7: the picture itself, for the client's model to see.
        if (out?.jpeg) return { content: [{ type: 'text', text: `The page as it looks now: ${out.url}` }, { type: 'image', data: out.jpeg, mimeType: 'image/jpeg' }] }
        return text(String(out?.problem ?? out), true)
      },
    }))
}

type Message = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any }

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError && { isError: true }) })

/** One `tools/call`: never throws, so a failure is a tool result the client can read (MCP-3). */
async function call(params: any, ask: Ask, cwd: string, served: Served[]) {
  const browsing = served.find((t) => t.name === params?.name)
  if (browsing) {
    try {
      return await browsing.run(params.arguments ?? {})
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true)
    }
  }
  if (params?.name !== TOOL.name) return text(`Unknown tool: ${params?.name}`, true)
  const args = params.arguments ?? {}
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) return text('prompt is required.', true)
  const directory = typeof args.directory === 'string' && args.directory ? args.directory : cwd
  if (!isAbsolute(directory)) return text(`directory must be an absolute path, not ${directory}.`, true)
  try {
    const files: string[] = Array.isArray(args.files) ? args.files.map(String) : []
    const attachments = await Promise.all(files.map((f) => attach(f, directory)))
    const { text: answer, model } = await ask({ prompt: args.prompt, directory, attachments })
    return text(`${answer}\n\n— answered by ${model}`)
  } catch (e) {
    return text(e instanceof Error ? e.message : String(e), true)
  }
}

/** Serves MCP over a pair of streams until input ends (MCP-1). Resolves when it does. */
export function serveMcp(
  ask: Ask,
  { input, output, cwd = process.cwd(), browser }: { input: Readable; output: Writable; cwd?: string; browser?: () => Tab },
) {
  const served = browser ? browserTools(browser, cwd) : []
  const send = (m: object) => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const lines = createInterface({ input })
  const inflight = new Set<Promise<unknown>>()

  const handle = async (m: Message): Promise<void> => {
    // A notification (no id) is never answered.
    const reply = m.id !== undefined && m.id !== null
    const result = (r: object) => {
      if (reply) send({ id: m.id, result: r })
    }
    switch (m.method) {
      case 'initialize':
        return result({
          protocolVersion: m.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'navi', version: '0.1.0' },
        })
      case 'ping':
        return result({})
      case 'tools/list':
        return result({ tools: [TOOL, ...served.map(({ run: _, ...t }) => t)] })
      case 'tools/call':
        return result(await call(m.params, ask, cwd, served))
      default:
        if (reply) send({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } })
    }
  }

  lines.on('line', (line) => {
    if (!line.trim()) return
    let m: Message
    try {
      m = JSON.parse(line)
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } })
    }
    // Each call runs on its own, so a long task never holds up a ping (MCP-5).
    const p = handle(m).finally(() => inflight.delete(p))
    inflight.add(p)
  })
  return new Promise<void>((resolve) =>
    lines.on('close', async () => {
      await Promise.all(inflight)
      resolve()
    }),
  )
}
