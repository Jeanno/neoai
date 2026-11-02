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
  /** The model the turn started on and why it left it (LED-3). */
  escalated?: { from: string; reason: string }
  /** The model whose answer this turn's prompt corrected (LED-7); never the prompt. */
  corrects?: string
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

const MAX_BYTES = 5 * 1024 * 1024

export const ledgerFile = (home: string) => join(home, '.neoai', 'ledger.jsonl')

/** Adds one turn (LED-1); never throws (LED-4). */
export async function record(home: string, entry: LedgerEntry): Promise<void> {
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

/** One line per model, most turns first (LED-6). */
export function stats(entries: LedgerEntry[], days: number): string {
  if (!entries.length) return `No turns recorded in the last ${days} day${days === 1 ? '' : 's'}.`
  const by = new Map<string, LedgerEntry[]>()
  for (const e of entries) by.set(e.model, [...(by.get(e.model) ?? []), e])
  // A turn that escalated away counts against the model it started on.
  const away = new Map<string, number>()
  for (const e of entries) if (e.escalated) away.set(e.escalated.from, (away.get(e.escalated.from) ?? 0) + 1)
  for (const from of away.keys()) if (!by.has(from)) by.set(from, [])
  const rows = [...by].sort((a, b) => b[1].length + (away.get(b[0]) ?? 0) - (a[1].length + (away.get(a[0]) ?? 0)))
  const lines = [`Last ${days} day${days === 1 ? '' : 's'}, ${entries.length} turn${entries.length === 1 ? '' : 's'}:`]
  for (const [model, turns] of rows) {
    const n = turns.length
    const count = (o: LedgerEntry['outcome']) => turns.filter((t) => t.outcome === o).length
    // LED-8: of its answers, how many the user then corrected.
    const corrected = entries.filter((e) => e.corrects === model).length
    const parts = n
      ? [
          `${n} turn${n === 1 ? '' : 's'}`,
          `${pct(count('answered'), n)} answered`,
          ...(count('empty') ? [`${pct(count('empty'), n)} empty`] : []),
          ...(count('error') ? [`${pct(count('error'), n)} failed`] : []),
          ...(count('stopped') ? [`${pct(count('stopped'), n)} stopped`] : []),
          ...(corrected && count('answered') ? [`${pct(Math.min(corrected, count('answered')), count('answered'))} of answers corrected`] : []),
          `${per(turns.reduce((s, t) => s + t.steps, 0), n)} steps`,
          `${per(turns.reduce((s, t) => s + t.toolErrors, 0), n)} tool errors`,
          `median ${seconds(median(turns.map((t) => t.ms)))}`,
        ]
      : ['0 turns of its own']
    const escalated = away.get(model)
    if (escalated) parts.push(`${escalated} escalated away`)
    lines.push(`  ${model}${turns[0]?.local === false ? ' (REMOTE)' : ''}: ${parts.join(' · ')}`)
  }
  return lines.join('\n')
}
