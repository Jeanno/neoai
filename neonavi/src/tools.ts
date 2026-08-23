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

/** A small model will happily read a 3 MB file into a 4k context otherwise. */
function clip(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s
}

export function makeTools(gate: Gate) {
  return {
    read_file: tool({
      description: 'Read a file and return its contents.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => clip(await readFile(path, 'utf8')),
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
