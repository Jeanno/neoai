import { tool } from 'ai'
import { z } from 'zod'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { promisify } from 'node:util'
import { fetchUrl, webSearch } from './web.ts'
import { makeSearch } from './search.ts'
import { diffLines, hasUnseen, summarize, type FileChange } from './diff.ts'
import { CONTEXT_FILE } from './context.ts'

/** Files agents read into their instructions: navi's own, and Claude Code's and others'. */
const CONTEXT_NAMES = new Set([CONTEXT_FILE, 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md'])

const run = promisify(exec)

export interface Gate {
  /**
   * Returns true to let the command run. Asked once per call; only an allowed command (TL-41) skips asking.
   * The signal aborts when the turn is stopped, which should decline.
   */
  approve: (command: string, signal?: AbortSignal, toolCallId?: string) => Promise<boolean>
  /**
   * Returns true to let a file change be made (TL-38). `inside` is whether
   * the file is in the working directory. Left out, every change declines.
   */
  change?: (change: FileChange & { inside: boolean }, signal?: AbortSignal, toolCallId?: string) => Promise<boolean>
}

const MAX_OUTPUT = 8000
const MAX_MATCHES = 100
const MAX_LINES = 400

/** A small model will happily read a 3 MB file into a 4k context otherwise. */
function clip(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s
}

export interface ToolOptions {
  /** false removes web_search, so only the model talks to the network (TL-30). */
  web?: boolean
  /** false removes only fetch_url (TL-35). */
  fetch?: boolean
  /** Where relative paths and shell commands start; a front end's process may sit elsewhere. */
  cwd?: string
  /** false forces the built-in grep/glob even where rg is installed (TL-31). */
  ripgrep?: boolean
  /** false removes write_file and edit_file (TL-40). */
  write?: boolean
}

export function makeTools(gate: Gate, { web = true, fetch = true, cwd = process.cwd(), ripgrep, write = true }: ToolOptions = {}) {
  const search = makeSearch({ cwd, ripgrep })
  const at = (path: string) => resolve(cwd, path)

  /**
   * Where `file` really lands, and whether that is a place a new file is safe
   * to make unasked: a symbolic link on the way, or at the file itself, can
   * lead out of the working directory however the path reads.
   */
  const landing = async (file: string): Promise<{ real: string; inside: boolean; moved: boolean }> => {
    const home = await realpath(cwd).catch(() => cwd)
    // A link at the file itself is written through, wherever it points.
    const link = await lstat(file).then((s) => s.isSymbolicLink(), () => false)
    // The nearest part of the path that exists is where links are resolved;
    // one that exists but cannot be resolved (a dangling link) leads nowhere known.
    let dir = link ? file : dirname(file)
    while (!(await lstat(dir).then(() => true, () => false)) && dirname(dir) !== dir) dir = dirname(dir)
    const resolved = await realpath(dir).catch(() => null)
    if (!resolved) return { real: file, inside: false, moved: false }
    const real = join(resolved, relative(dir, file))
    const rel = relative(home, real)
    const within = !!rel && !rel.startsWith('..') && !isAbsolute(rel)
    // A hidden name (.git/hooks, .github/workflows, .envrc) is one that tools
    // and shells run on their own, and a context file is read into every later
    // session's instructions, so making either is never taken as safe.
    const loaded = rel.split(sep).some((part) => part.startsWith('.')) || CONTEXT_NAMES.has(basename(real))
    // Moved: a link took it somewhere the path, read from the working directory, does not say.
    const moved = real !== join(home, relative(cwd, file))
    return { real, inside: within && !loaded && !link, moved }
  }

  /** Shows the change, asks, and makes it only when approved (TL-38, TL-39). */
  const apply = async (path: string, before: string | null, after: string, signal?: AbortSignal, id?: string) => {
    // A path no one can read on the question line is not one to approve.
    if (hasUnseen(path)) return 'The path has control or invisible characters in it; nothing was written. Use a plain path.'
    const file = at(path)
    if (before === after) return `${path} already reads that way; nothing changed.`
    const { real, inside, moved } = await landing(file)
    const change: FileChange = { path, created: before === null, ...(moved && { lands: real }), ...diffLines(before ?? '', after) }
    if (!gate.change || !(await gate.change({ ...change, inside }, signal, id)))
      return `The user declined to ${summarize(change)}. Do not retry it; try another approach.`
    try {
      // Approval can take minutes: a file changed meanwhile is not overwritten
      // with the old read, and a path that now leads elsewhere is not followed.
      if ((await current(path)) !== before) return `${path} changed since it was read; nothing was written. Read it again.`
      if ((await landing(file)).real !== real) return `${path} now leads somewhere else; nothing was written.`
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, after, { flag: before === null ? 'wx' : 'w' })
    } catch (e: any) {
      if (e.code === 'EEXIST') return `${path} appeared since it was read; nothing was written. Read it again.`
      return `could not write ${path}: ${e.message}`
    }
    return `${change.created ? 'created' : 'edited'} ${path}: +${change.added} -${change.removed} lines`
  }

  /** The file's text, or null when there is none to read. */
  const current = (path: string) => readFile(at(path), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
  const tools = {
    grep: tool({
      description: 'Search file contents for a pattern. Returns file:line:text.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional(),
      }),
      execute: async ({ pattern, path }) => {
        const hits = await search.grep(pattern, path ?? '.')
        if (!hits.length) return `no matches for ${pattern}`
        const shown = clip(hits.slice(0, MAX_MATCHES).join('\n'))
        return hits.length > MAX_MATCHES
          ? `${shown}\n…[${hits.length - MAX_MATCHES} more matches not shown]`
          : shown
      },
    }),

    glob: tool({
      description: 'Find files whose names match a pattern, e.g. "*.ts".',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional(),
      }),
      execute: async ({ pattern, path }) => {
        const files = await search.files(pattern, path ?? '.')
        if (!files.length) return `no files matching ${pattern}`
        const shown = clip(files.slice(0, MAX_MATCHES).join('\n'))
        return files.length > MAX_MATCHES
          ? `${shown}\n…[${files.length - MAX_MATCHES} more files not shown]`
          : shown
      },
    }),

    read_file: tool({
      description:
        'Read a file. Returns numbered lines. Use offset and limit to page ' +
        'through a file too long to return at once.',
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().optional().describe('first line to return, 1-based'),
        limit: z.number().optional().describe('how many lines to return'),
      }),
      execute: async ({ path, offset = 1, limit = MAX_LINES }) => {
        const lines = (await readFile(at(path), 'utf8')).split('\n')
        const start = Math.max(1, offset)
        const slice = lines.slice(start - 1, start - 1 + limit)
        // Numbered so the model can cite a line. Cut on a line boundary whether
        // the limit or the size budget runs out first, so the tail is never half
        // a token and there is always a stated way to continue.
        const kept: string[] = []
        let size = 0
        for (const [i, l] of slice.entries()) {
          const numbered = `${start + i}→${l}`
          if (size + numbered.length > MAX_OUTPUT && kept.length) break
          kept.push(numbered)
          size += numbered.length + 1
        }
        const end = start + kept.length - 1
        const body = kept.join('\n')
        return end < lines.length
          ? `${body}\n…[${lines.length - end} more lines; read again with offset ${end + 1}]`
          : body
      },
    }),

    list_dir: tool({
      description: 'List the entries in a directory.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => clip((await readdir(at(path))).join('\n')),
    }),

    run_shell: tool({
      description: 'Run a shell command. The user is asked to approve it first.',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }, { abortSignal, toolCallId }) => {
        if (!(await gate.approve(command, abortSignal, toolCallId)))
          return `The user declined to run: ${command}. Do not retry it; try another approach.`
        try {
          const { stdout, stderr } = await run(command, { cwd, timeout: 120_000, signal: abortSignal })
          return clip(stdout || stderr || '(no output)')
        } catch (e: any) {
          // The model needs to see the failure to recover from it.
          return clip(`command failed: ${e.stderr || e.message}`)
        }
      },
    }),

    write_file: tool({
      description:
        'Create a file, or replace one whole, with the given content. The user ' +
        'sees the change and may be asked first. To change part of a file, use edit_file.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }, { abortSignal, toolCallId }) => {
        try {
          return await apply(path, await current(path), content, abortSignal, toolCallId)
        } catch (e: any) {
          return `could not read ${path}: ${e.message}`
        }
      },
    }),

    edit_file: tool({
      description:
        'Replace old_text with new_text in an existing file. old_text must match ' +
        'the file exactly, whitespace included, and occur once: include enough ' +
        'surrounding lines to make it unique. Read the file first.',
      inputSchema: z.object({ path: z.string(), old_text: z.string(), new_text: z.string() }),
      execute: async ({ path, old_text, new_text }, { abortSignal, toolCallId }) => {
        let before: string | null
        try {
          before = await current(path)
        } catch (e: any) {
          return `could not read ${path}: ${e.message}`
        }
        if (before === null) return `${path} does not exist; use write_file to create it.`
        if (!old_text) return 'old_text is empty; give the exact text to replace.'
        const count = before.split(old_text).length - 1
        if (count === 0) return `old_text was not found in ${path}; read the file and copy the text exactly.`
        if (count > 1) return `old_text occurs ${count} times in ${path}; include more surrounding lines so it occurs once.`
        // A function replacer, so `$&` and friends in new_text stay literal.
        return apply(path, before, before.replace(old_text, () => new_text), abortSignal, toolCallId)
      },
    }),

    web_search: tool({
      description:
        'Search the web. Returns numbered results with title, URL and snippet. ' +
        'Use it for anything that may have changed since your training.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => clip(await webSearch(query)),
    }),

    fetch_url: tool({
      description:
        'Read one web page (http or https) as text. Use it for a URL the user gives ' +
        'or a search result worth opening.',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => clip(await fetchUrl(url)),
    }),
  }
  // Removed rather than typed optional, so callers keep exact tool types.
  if (!web) delete (tools as Partial<typeof tools>).web_search
  if (!web || !fetch) delete (tools as Partial<typeof tools>).fetch_url
  if (!write) {
    delete (tools as Partial<typeof tools>).write_file
    delete (tools as Partial<typeof tools>).edit_file
  }
  return tools
}
