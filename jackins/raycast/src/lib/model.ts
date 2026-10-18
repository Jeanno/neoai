import { getPreferenceValues } from '@raycast/api'
import type { LanguageModel } from 'ai'
import { parseModelSpec, resolveChain } from 'neonavi/spec'
import { auto, probeBackend, readConfig } from 'neorouter'

export interface Navi {
  llm: LanguageModel
  /** Which backend and model answered, e.g. "darkbloom · Qwen3.8-27B". */
  label: string
  /** False when prompts leave the machine. */
  local: boolean
}

let pending: Promise<Navi> | undefined

/**
 * The chain navi walks, from the Model preference or else `model` in
 * ~/.neoai/config.json. Resolved once per command; a failure is not cached, so
 * starting a server and asking again works.
 */
export function resolveNavi(): Promise<Navi> {
  pending ??= resolve().catch((error) => {
    pending = undefined
    throw error
  })
  return pending
}

async function resolve(): Promise<Navi> {
  const override = getPreferenceValues<Preferences>().model?.trim()
  const chain = parseModelSpec(override || (await readConfig()).model)
  const chosen = await resolveChain(chain)
  if (!chosen) {
    throw new Error(
      `No model found (${chain.map((e) => e.id ?? e.where).join(' → ')}). Open LM Studio and start its server, or run navi setup in Terminal.`,
    )
  }
  const { prefer, remote, model, scope } = chosen.options
  // Memoised inside neorouter: this is the resolution resolveChain just made.
  const r = await probeBackend(prefer, remote, model, scope)
  return {
    llm: auto(chosen.options),
    label: r ? `${r.backend} · ${r.modelId}` : 'navi',
    local: r?.local ?? true,
  }
}
