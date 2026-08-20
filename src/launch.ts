import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Server } from './types.ts'

const run = promisify(execFile)

const MODEL_DIRS = [
  '.lmstudio/models',
  'models',
  '.cache/huggingface/hub',
  '.cache/lm-studio/models',
  'Library/Application Support/nomic.ai/GPT4All',
].map((d) => join(homedir(), d))

export interface Launchable {
  backend: string
  bin: string
  /** Absolute .gguf paths; empty for runtimes that manage their own store. */
  files: string[]
  from?: string
}

async function which(bin: string): Promise<string | null> {
  try {
    return (await run('which', [bin])).stdout.trim() || null
  } catch {
    return null
  }
}

async function ggufsIn(dir: string): Promise<string[]> {
  try {
    if (!(await stat(dir)).isDirectory()) return []
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.gguf'))
      .map((e) => join(e.parentPath ?? dir, e.name))
  } catch {
    return []
  }
}

/** Rung 2: a runtime is installed but nothing is listening. */
export async function launchable(reachable: Server[]): Promise<Launchable[]> {
  const out: Launchable[] = []
  const have = new Set(reachable.map((s) => s.backend))

  const ollama = await which('ollama')
  if (ollama && !have.has('ollama')) out.push({ backend: 'ollama', bin: ollama, files: [] })

  const llama = await which('llama-server')
  if (llama && !have.has('llama.cpp')) {
    const found = await Promise.all(MODEL_DIRS.map(ggufsIn))
    const files = found.flat()
    if (files.length) out.push({ backend: 'llama.cpp', bin: llama, files, from: MODEL_DIRS[0] })
  }
  return out
}

const children: ChildProcess[] = []

async function waitFor(url: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

export interface Launched {
  server: Server
  pid: number
  coldStartMs: number
}

export async function launch(l: Launchable, modelFile?: string): Promise<Launched | null> {
  const t0 = Date.now()
  const [cmd, args, baseURL, health] =
    l.backend === 'ollama'
      ? [l.bin, ['serve'], 'http://127.0.0.1:11434', 'http://127.0.0.1:11434/api/tags']
      : [
          l.bin,
          ['-m', modelFile!, '--host', '127.0.0.1', '--port', '8080', '--no-webui'],
          'http://127.0.0.1:8080/v1',
          'http://127.0.0.1:8080/health',
        ]

  const child = spawn(cmd, args, { stdio: 'ignore', detached: false })
  children.push(child)
  // Model load dominates; llama.cpp needs far longer than ollama's daemon.
  if (!(await waitFor(health, l.backend === 'ollama' ? 10_000 : 120_000))) {
    child.kill()
    return null
  }
  return {
    server: { backend: l.backend, baseURL, native: l.backend === 'ollama' ? 'ollama' : undefined },
    pid: child.pid!,
    coldStartMs: Date.now() - t0,
  }
}

/** Only ever kills servers we started. */
export function shutdown(): void {
  for (const c of children.splice(0)) c.kill()
}

process.once('exit', shutdown)
