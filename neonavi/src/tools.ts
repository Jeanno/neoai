import { tool } from 'ai'
import { z } from 'zod'
import { readFile, readdir } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(exec)

export interface Gate {
  /** Returns true to let the command run. Asked once per call, never cached. */
  approve: (command: string) => Promise<boolean>
}

const MAX_OUTPUT = 8000
const MAX_MATCHES = 100
const MAX_LINES = 400

/** A small model will happily read a 3 MB file into a 4k context otherwise. */
function clip(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s
}

/**
 * ripgrep, not grep: it honors .gitignore and skips hidden files, so a search
 * in a JS project returns the answer instead of thousands of node_modules hits.
 */
async function rg(args: string[]): Promise<string[]> {
  // .gitignore covers these in a real project, but not in a directory that has
  // no .gitignore — and dependency hits are never the answer either way.
  const never = ['-g', '!node_modules', '-g', '!.git']
  try {
    const cmd = ['rg', ...never, ...args].map(quote).join(' ')
    const { stdout } = await run(cmd, { maxBuffer: 1 << 24 })
    return stdout.split('\n').filter(Boolean)
  } catch (e: any) {
    // rg exits 1 with no output when nothing matched; that is not an error.
    if (e.code === 1 && !e.stderr) return []
    throw e
  }
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

export function makeTools(gate: Gate) {
  return {
    grep: tool({
      description: 'Search file contents for a pattern. Returns file:line:text.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional(),
      }),
      execute: async ({ pattern, path }) => {
        const hits = await rg(['--line-number', '--with-filename', pattern, path ?? '.'])
        if (!hits.length) return `no matches for ${pattern}`
        const shown = hits.slice(0, MAX_MATCHES).join('\n')
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
        const files = await rg(['--files', '-g', pattern, path ?? '.'])
        if (!files.length) return `no files matching ${pattern}`
        return clip(files.slice(0, MAX_MATCHES).join('\n'))
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
        const lines = (await readFile(path, 'utf8')).split('\n')
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
      execute: async ({ path }) => clip((await readdir(path)).join('\n')),
    }),

    run_shell: tool({
      description: 'Run a shell command. The user is asked to approve it first.',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        if (!(await gate.approve(command)))
          return `The user declined to run: ${command}. Do not retry it; try another approach.`
        try {
          const { stdout, stderr } = await run(command, { timeout: 120_000 })
          return clip(stdout || stderr || '(no output)')
        } catch (e: any) {
          // The model needs to see the failure to recover from it.
          return clip(`command failed: ${e.stderr || e.message}`)
        }
      },
    }),
  }
}
