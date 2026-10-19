import { describe, type Answering, type Choice, type ProviderRow, type Slot, type Status } from 'neonavi/setup'
import { modelLabel } from './labels'

/**
 * What Set Up Navi shows, worked out from what setup's core returns (SET-23).
 * The core decides every choice; this only words it for Raycast, and keeps a
 * local server's app out of the words (RAY-9).
 */

export interface SlotItem {
  slot: Slot | null
  title: string
  subtitle: string
  /** This link answers now. */
  answers: boolean
}

/** The primary, the fallback and any later links, marking the one that answers (SET-13). */
export function slotItems(s: Status): SlotItem[] {
  const at = s.answering?.index
  return [
    { slot: 0, title: 'Primary', subtitle: s.primary.label, answers: at === 0 },
    { slot: 1, title: 'Fallback', subtitle: s.fallback?.label ?? 'none', answers: at === 1 },
    ...s.later.map((l, i) => ({ slot: null, title: `Then (${i + 3})`, subtitle: l.label, answers: at === i + 2 })),
  ]
}

/** The model that answers, named by its id when it is local (RAY-9). */
export function relabel(a: Answering | null): Answering | null {
  return a && { ...a, label: modelLabel(a) }
}

export type TestState =
  { state: 'asking' } | { state: 'done'; ok: true; reply: string } | { state: 'done'; ok: false; error: string }

/** SET-1 in a sentence, then the test question's reply or error (SET-11). */
export function statusMarkdown(s: Status, test?: TestState | null): string {
  const parts = [describe(relabel(s.answering), (x) => `**${x}**`)]
  if (!s.answering)
    parts.push(
      'Choose a model for the primary slot: one on this computer (Local), a provider with your key, or your own endpoint (Custom).',
    )
  if (test?.state === 'asking') parts.push('_Asking it a test question…_')
  else if (test?.state === 'done' && test.ok) parts.push(`**Test reply:** ${test.reply}`)
  else if (test?.state === 'done') parts.push(`**The model didn't answer:** ${test.error}`)
  return parts.join('\n\n')
}

/** Whether a provider has a key, and where it comes from (SET-19). */
export function providerAccessory(p: ProviderRow): string | undefined {
  if (p.key === 'saved') return 'key saved'
  if (p.key === 'env') return `key from ${p.env}`
  return undefined
}

export interface ChoiceItem {
  id: string
  value: string | null
  title: string
  subtitle?: string
  current: boolean
}

/**
 * Choices as list rows. Local models drop the core's detail, which names the
 * server they run on: the user picked a model, not an app (RAY-9).
 */
export function choiceItems(choices: Choice[], o: { local?: boolean } = {}): ChoiceItem[] {
  return choices.map((c) => ({
    id: c.value ?? 'none',
    value: c.value,
    title: c.label,
    subtitle: o.local ? undefined : c.detail,
    current: c.current,
  }))
}

export const SLOT_NAME = ['Primary', 'Fallback'] as const
