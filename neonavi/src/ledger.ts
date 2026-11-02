import { appendFile, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * How each turn went, as counts (ledger.md): what model answered, how long
 * it took, which tools it used, and how it ended. Never what was said (LED-2).
 */
export interface LedgerEntry {
  /** When the turn ended, ISO 8601. */
  at: string
  front: string
  /** The answering model, `<backend> · <model id>`. */
  model: string
  /** True when prompts stayed on this computer. */
  local: boolean
  ms: number
  steps: number
  /** Each tool called, by name, with how many times. */
  tools: Record<string, number>
  toolErrors: number
  declined: number
  promptChars: number
  attachments: number
  outcome: 'answered' | 'empty' | 'error' | 'stopped'
  /** The model the turn started on and why it left it (LED-3); `routed` when it never started there (ESC-6). */
  escalated?: { from: string; reason: string; routed?: true }
  /** What sort of turn it was, by its prompt's first words (LED-11); never the prompt. */
  kind?: TurnKind
  /** The model whose answer this turn's prompt corrected (LED-7); never the prompt. */
  corrects?: string
  /** The model whose answer this turn asked again for, in other words (LED-13); never the prompt. */
  repeats?: string
  /** The kind of the turn corrected or asked again (LED-15), for routing (ESC-7). */
  aboutKind?: TurnKind
  /** The answer ended at the token cap (HAR-11). */
  cut?: true
}

/** A line saying the user undid a turn's changes (LED-9): when, and whose turn; nothing else. */
export interface UndoneEntry {
  at: string
  undid: string
  /** The undone turn's kind, by its prompt (LED-15). */
  kind?: TurnKind
}

/**
 * Notes that the user undid turns' file changes (LED-9), one line per turn
 * whose model is known; only when something was put back. Never throws.
 */
export async function recordUndone(home: string, turns: { model?: string; prompt?: string }[], put: boolean, now = new Date()): Promise<void> {
  if (!put) return
  // LED-15: the turn's kind by its prompt; what was attached to it is not kept with it.
  for (const t of turns) if (t.model) await record(home, { at: now.toISOString(), undid: t.model, ...(t.prompt !== undefined && { kind: kindOf(t.prompt, 0) }) })
}

/** The undo lines since `since` (LED-9). */
export async function readUndoneEntries(home: string, since = 0): Promise<UndoneEntry[]> {
  const text = await readFile(ledgerFile(home), 'utf8').catch(() => '')
  const out: UndoneEntry[] = []
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line) as Partial<UndoneEntry>
      if (typeof e.undid === 'string' && typeof e.at === 'string' && Date.parse(e.at) >= since) out.push(e as UndoneEntry)
    } catch {
      // As readLedger.
    }
  }
  return out
}

/** The models of the turns undone since `since` (LED-9). */
export async function readUndone(home: string, since = 0): Promise<string[]> {
  return (await readUndoneEntries(home, since)).map((e) => e.undid)
}

/** How soon after an answer a correction still counts as one (LED-7). */
export const CORRECTION_WINDOW = 30 * 60_000

const KIND = /^(no\b(?![ ,]*(worries|problem|thanks|need|rush|hurry))|nope\b|wrong\b|incorrect\b|not (quite|right|it|what|that|correct)\b|that('s| is| was)? (wrong|not|incorrect|didn'?t|did not|doesn'?t|does not)\b|(it|this|that) (still )?(doesn'?t|does not|didn'?t|did not|isn'?t|is not|won'?t|wasn'?t)\b|still (doesn'?t|does not|didn'?t|not|broken|fail|fails|failing|wrong|the same)\b|try again\b|you (missed|forgot|didn'?t|did not|broke|got it wrong)\b|(that|it|this) (broke|failed)\b)/

/**
 * Whether a prompt reads as the user saying the answer before was wrong
 * (LED-7): by its first words only, so asking about a thing that is wrong
 * is not taken for it.
 */
export function readsAsCorrection(prompt: string): boolean {
  const start = prompt.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/^[^a-z]+/, '')
  return KIND.test(start)
}

/** A turn as the ledger sorts it (LED-11). */
export type TurnKind = 'change' | 'attached' | 'ask'

const CHANGE = /^(please |can you |could you )?(fix|add|change|edit|write|rewrite|refactor|rename|update|create|make|implement|remove|delete|move|replace|convert|set up|install|bump|upgrade|clean up|tidy)\b/

/** Files sent with it, a change asked for by its first words, or else a question (LED-11). */
export function kindOf(prompt: string, attachments: number): TurnKind {
  if (attachments > 0) return 'attached'
  const start = prompt.trim().toLowerCase().replace(/^[^a-z]+/, '')
  return CHANGE.test(start) ? 'change' : 'ask'
}

const KIND_WORDS: Record<TurnKind, string> = { change: 'turns asking for a change', attached: 'turns with files', ask: 'questions' }

/** How far back, how many of the latest turns, and how few are too few to judge by (ESC-6). */
export const ROUTE_DAYS = 30
export const ROUTE_LAST = 10
export const ROUTE_MIN = 5

/**
 * Why a turn of this kind should not start on `model` (ESC-6): more than half
 * of its latest such turns that started on it went badly (it escalated away,
 * or ended with an error or nothing), counting too each of its answers of
 * that kind the user corrected, asked for again or undid since the first of
 * them (ESC-7). Turns routed past it are not its own, so a model gets another
 * go once its bad turns are old. Undefined when it should start there.
 */
export function routeAway(entries: LedgerEntry[], model: string, kind: TurnKind, undone: UndoneEntry[] = []): string | undefined {
  const started = entries.filter(
    (e) => e.kind === kind && e.outcome !== 'stopped' && !e.escalated?.routed && (e.escalated ? e.escalated.from === model : e.model === model),
  ).slice(-ROUTE_LAST)
  const since = started.length ? started[0].at : ''
  const told =
    entries.filter((e) => e.aboutKind === kind && e.at >= since && (e.corrects === model || e.repeats === model)).length +
    undone.filter((u) => u.kind === kind && u.undid === model && u.at >= since).length
  const failed = started.filter((e) => e.escalated || e.outcome === 'error' || e.outcome === 'empty').length
  // A turn can go badly more than one way; it is still one turn.
  const bad = Math.min(started.length, failed + told)
  if (started.length < ROUTE_MIN || bad * 2 <= started.length) return
  return `by the ledger, ${model} went badly on ${bad} of its last ${started.length} ${KIND_WORDS[kind]}`
}

const STOP = new Set('a an and are as at be by can could do does for from how i in is it me my of on or please should so that the this to was what when where which why will with would you your'.split(' '))
const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)))

/**
 * Whether a prompt asks the one before it again (LED-13): at least three words
 * that matter in each, and more than 60% of them shared, so a new request
 * that only shares a verb or two ("fix the login bug", "fix the signup bug")
 * is not taken for it.
 */
export function readsAsRepeat(prompt: string, before: string): boolean {
  const a = words(prompt)
  const b = words(before)
  if (a.size < 3 || b.size < 3) return false
  const shared = [...a].filter((w) => b.has(w)).length
  return shared / (a.size + b.size - shared) > 0.6
}

const MAX_BYTES = 5 * 1024 * 1024

export const ledgerFile = (home: string) => join(home, '.neoai', 'ledger.jsonl')

/** Adds one turn (LED-1); never throws (LED-4). */
export async function record(home: string, entry: LedgerEntry | UndoneEntry): Promise<void> {
  const file = ledgerFile(home)
  try {
    await mkdir(join(home, '.neoai'), { recursive: true, mode: 0o700 })
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    // A file made before by something with a looser umask is tightened too.
    await chmod(file, 0o600)
    if ((await stat(file)).size > MAX_BYTES) {
      const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
      await writeFile(file, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`, { mode: 0o600 })
    }
  } catch {
    // The turn already happened; a ledger that cannot be written is not its problem.
  }
}

/** The turns that ended since `since`, oldest first; lines that do not read are skipped (LED-4). */
export async function readLedger(home: string, since = 0): Promise<LedgerEntry[]> {
  const text = await readFile(ledgerFile(home), 'utf8').catch(() => '')
  const out: LedgerEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as LedgerEntry
      if (typeof e.model === 'string' && typeof e.at === 'string' && Date.parse(e.at) >= since) out.push(e)
    } catch {
      // A line cut short by a crash, or written by hand.
    }
  }
  return out
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`
const per = (n: number, of: number) => (n / of).toFixed(1)

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

const seconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)

/** Turns that changed a file, as far as the ledger can tell (LED-10). */
const editing = (turns: LedgerEntry[]) => turns.filter((t) => (t.tools.write_file ?? 0) + (t.tools.edit_file ?? 0) > 0).length

const KINDS: TurnKind[] = ['change', 'ask', 'attached']

/**
 * A model's turns by kind (LED-16), a line each, when they are of more than
 * one kind or routing (ESC-6) would start some elsewhere now.
 */
function kindLines(model: string, turns: LedgerEntry[], entries: LedgerEntry[], undone: UndoneEntry[], route?: Routing): string[] {
  const away = new Map(KINDS.map((k) => [k, route && routeAway(route.entries, model, k, route.undone)]))
  const kinds = KINDS.filter((k) => turns.some((t) => t.kind === k))
  if (kinds.length < 2 && ![...away.values()].some(Boolean)) return []
  return KINDS.filter((k) => kinds.includes(k) || away.get(k)).map((k) => {
    const of = turns.filter((t) => t.kind === k)
    const answered = of.filter((t) => t.outcome === 'answered').length
    const told = (field: 'corrects' | 'repeats') => entries.filter((e) => e[field] === model && e.aboutKind === k).length
    const undid = undone.filter((u) => u.undid === model && u.kind === k).length
    const parts = [
      `${of.length} turn${of.length === 1 ? '' : 's'}`,
      ...(of.length ? [`${pct(answered, of.length)} answered`] : []),
      ...(told('corrects') && answered ? [`${pct(Math.min(told('corrects'), answered), answered)} corrected`] : []),
      ...(told('repeats') && answered ? [`${pct(Math.min(told('repeats'), answered), answered)} asked again`] : []),
      ...(undid ? [editing(of) ? `${pct(Math.min(undid, editing(of)), editing(of))} of edits undone` : `${undid} undone`] : []),
      ...(away.get(k) ? ['routing starts these elsewhere now'] : []),
    ]
    return `      ${KIND_NAMES[k]}: ${parts.join(' · ')}`
  })
}

const KIND_NAMES: Record<TurnKind, string> = { change: 'changes', ask: 'questions', attached: 'with files' }

/** What routing by the ledger (ESC-6) reads: its own window, not the one shown. */
export interface Routing {
  entries: LedgerEntry[]
  undone: UndoneEntry[]
}

/** One line per model, most turns first (LED-6), each with its kinds of turn under it (LED-16). */
export function stats(entries: LedgerEntry[], days: number, undoneGiven: (string | UndoneEntry)[] = [], route?: Routing): string {
  const undoneEntries = undoneGiven.map((u) => (typeof u === 'string' ? { at: '', undid: u } : u))
  const undone = undoneEntries.map((u) => u.undid)
  if (!entries.length) return `No turns recorded in the last ${days} day${days === 1 ? '' : 's'}.`
  const by = new Map<string, LedgerEntry[]>()
  for (const e of entries) by.set(e.model, [...(by.get(e.model) ?? []), e])
  // A turn that escalated away counts against the model it started on.
  // A turn routed past a model (ESC-6) never started there: counted apart.
  const away = new Map<string, number>()
  const past = new Map<string, number>()
  for (const e of entries) {
    const into = e.escalated?.routed ? past : away
    if (e.escalated) into.set(e.escalated.from, (into.get(e.escalated.from) ?? 0) + 1)
  }
  for (const from of [...away.keys(), ...past.keys()]) if (!by.has(from)) by.set(from, [])
  const rows = [...by].sort((a, b) => b[1].length + (away.get(b[0]) ?? 0) - (a[1].length + (away.get(a[0]) ?? 0)))
  const lines = [`Last ${days} day${days === 1 ? '' : 's'}, ${entries.length} turn${entries.length === 1 ? '' : 's'}:`]
  for (const [model, turns] of rows) {
    const n = turns.length
    const count = (o: LedgerEntry['outcome']) => turns.filter((t) => t.outcome === o).length
    // LED-8: of its answers, how many the user then corrected.
    const corrected = entries.filter((e) => e.corrects === model).length
    // LED-14: and how many were asked for again.
    const repeated = entries.filter((e) => e.repeats === model).length
    // LED-10: and how many turns' changes the user undid.
    const undid = undone.filter((m) => m === model).length
    const parts = n
      ? [
          `${n} turn${n === 1 ? '' : 's'}`,
          `${pct(count('answered'), n)} answered`,
          ...(count('empty') ? [`${pct(count('empty'), n)} empty`] : []),
          ...(count('error') ? [`${pct(count('error'), n)} failed`] : []),
          ...(count('stopped') ? [`${pct(count('stopped'), n)} stopped`] : []),
          ...(corrected && count('answered') ? [`${pct(Math.min(corrected, count('answered')), count('answered'))} of answers corrected`] : []),
          ...(repeated && count('answered') ? [`${pct(Math.min(repeated, count('answered')), count('answered'))} asked again`] : []),
          ...(undid ? [editing(turns) ? `${pct(Math.min(undid, editing(turns)), editing(turns))} of edits undone` : `${undid} undone`] : []),
          `${per(turns.reduce((s, t) => s + t.steps, 0), n)} steps`,
          `${per(turns.reduce((s, t) => s + t.toolErrors, 0), n)} tool errors`,
          `median ${seconds(median(turns.map((t) => t.ms)))}`,
        ]
      : ['0 turns of its own']
    const escalated = away.get(model)
    if (escalated) parts.push(`${escalated} escalated away`)
    const routed = past.get(model)
    if (routed) parts.push(`${routed} routed past it`)
    lines.push(`  ${model}${turns[0]?.local === false ? ' (REMOTE)' : ''}: ${parts.join(' · ')}`)
    lines.push(...kindLines(model, turns, entries, undoneEntries, route))
  }
  return lines.join('\n')
}
