import './quiet'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseModelSpec, resolveChain, type Chosen } from 'neonavi/spec'
import { auto, readConfig, reset } from 'neorouter'
import { modelLabel } from 'neonavi/setup'

export interface Navi {
  chosen: Chosen
  model: ReturnType<typeof auto>
  /** The model as the user would know it (RAY-9, SET-25), e.g. "qwen3-4b" or "claude-sonnet-5-5 on Anthropic". */
  label: string
  /** False when prompts leave the machine. */
  local: boolean
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^neorouter: /, '') : String(error)
}

let pending: Promise<Navi | null> | undefined

/**
 * The chain navi walks, from `model` in ~/.neoai/config.json (RAY-8), or null
 * when nothing in it answers (RAY-7). Resolved once per command; neither null
 * nor a failure is kept, so starting a server or finishing Set Up Navi and
 * asking again works.
 */
export function resolveNavi(): Promise<Navi | null> {
  pending ??= resolve().then(
    (navi) => {
      if (!navi) pending = undefined
      return navi
    },
    (error) => {
      pending = undefined
      throw error
    },
  )
  return pending
}

/** Forgets every resolution, here and in neorouter, after setup changed something. */
export function forgetNavi(): void {
  pending = undefined
  reset()
}

async function resolve(): Promise<Navi | null> {
  const config = await readConfig()
  const chosen = await resolveChain(parseModelSpec(config.model, Object.keys(config.custom ?? {})))
  if (!chosen) return null
  return { chosen, model: auto(chosen.options), label: modelLabel(chosen), local: chosen.local }
}

/**
 * Where the harness works (RAY-1): Raycast has no project, and the judge's
 * "writes only inside the working directory" then keeps unasked writes out of
 * the home folder.
 */
export async function naviHome(): Promise<string> {
  const dir = join(homedir(), '.navi-raycast')
  await mkdir(dir, { recursive: true })
  return dir
}
