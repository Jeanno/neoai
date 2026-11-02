import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasUnseen } from './diff.ts'

/** Facts about the user kept between conversations (memory.md). */

export const MAX_MEMORY = 4000
export const MAX_FACT = 300

export const memoryFile = (home: string) => join(home, '.neoai', 'memory.md')

/** The facts in the file, in order (MEM-1); none when there is no file. */
export async function readMemory(home: string): Promise<string[]> {
  const text = await readFile(memoryFile(home), 'utf8').catch(() => '')
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
}

/** The prompt's memory section (MEM-2, MEM-3), or nothing. */
export function memorySection(facts: string[]): string {
  if (!facts.length) return ''
  let text = facts.map((f) => `- ${f}`).join('\n')
  if (text.length > MAX_MEMORY) text = `${text.slice(0, MAX_MEMORY)}\n…[memory truncated]`
  return ['', 'What you remember about the user (they wrote or approved each line; use it when it helps, never recite it):', text].join('\n')
}

const same = (a: string) => a.toLowerCase().replace(/\s+/g, ' ')

/** Why a fact cannot be added, or nothing (MEM-6). */
export function checkFact(fact: string, facts: string[]): string | undefined {
  const f = fact.trim()
  if (!f) return 'The fact is empty.'
  if (/[\r\n]/.test(f)) return 'A fact is one line; say it in one sentence.'
  if (hasUnseen(f)) return 'The fact has control or invisible characters in it.'
  if (f.length > MAX_FACT) return `A fact is at most ${MAX_FACT} characters; say it shorter.`
  if (facts.some((x) => same(x) === same(f))) return 'That is already remembered.'
  if ([...facts, f].map((x) => `- ${x}`).join('\n').length > MAX_MEMORY)
    return `Memory is full (${MAX_MEMORY} characters). The user can make room with navi memory forget.`
}

async function save(home: string, facts: string[]) {
  const file = memoryFile(home)
  await mkdir(join(home, '.neoai'), { recursive: true, mode: 0o700 })
  await writeFile(`${file}.tmp`, facts.map((f) => `- ${f}\n`).join(''), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
  await chmod(file, 0o600)
}

/** Adds a fact; why not, or nothing when it was added. */
export async function addFact(home: string, fact: string): Promise<string | undefined> {
  const facts = await readMemory(home)
  const problem = checkFact(fact, facts)
  if (problem) return problem
  await save(home, [...facts, fact.trim()])
}

/**
 * Removes the fact numbered `which` (from 1), or the one fact containing
 * those words (MEM-11): the fact removed, or the matches when not exactly one.
 */
export async function forgetFact(home: string, which: string): Promise<{ removed: string } | { matches: string[] }> {
  const facts = await readMemory(home)
  const w = which.trim()
  let at: number
  if (/^\d+$/.test(w)) at = Number(w) - 1
  else {
    const matches = w ? facts.filter((f) => same(f).includes(same(w))) : []
    if (matches.length !== 1) return { matches }
    at = facts.indexOf(matches[0])
  }
  if (at < 0 || at >= facts.length) return { matches: [] }
  const [removed] = facts.splice(at, 1)
  await save(home, facts)
  return { removed }
}
