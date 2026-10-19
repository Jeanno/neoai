import { providerById } from 'neorouter'

/**
 * A resolved model in words (RAY-9): a local model by its id alone, since the
 * user picked a model, not the app serving it; a provider or custom model with
 * the provider's name, which the user did pick.
 */
export function modelLabel(chosen: { backend: string; modelId: string; local: boolean }): string {
  if (chosen.local) return chosen.modelId
  return `${providerById(chosen.backend)?.name ?? chosen.backend} · ${chosen.modelId}`
}

/** The label with a note when prompts leave the machine. */
export function whereLabel(navi: { label: string; local: boolean }): string {
  return navi.local ? navi.label : `${navi.label} (remote)`
}
