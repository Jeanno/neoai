import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hasUnseen } from './diff.ts'

/** Facts about the user kept between conversations (memory.md). */

export const MAX_MEMORY = 4000
export const MAX_FACT = 300

/** The user's facts, or with `project` (its root) that project's (MEM-14). */
export const memoryFile = (home: string, project?: string) =>
  project
    ? join(home, '.neoai', 'memory', `${createHash('sha256').update(project).digest('hex').slice(0, 16)}.md`)
    : join(home, '.neoai', 'memory.md')

/**
 * The project a directory is in (MEM-14): the repository around it, or the
 * directory itself outside one; none at home, whose facts are the user's.
 */
export async function projectRoot(cwd: string, home: string): Promise<string | undefined> {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (dir === home) break
    if (await stat(join(dir, '.git')).then(() => true, () => false)) return dir
    if (dirname(dir) === dir) break
  }
  return cwd === home ? undefined : cwd
}

/** The facts in the file, in order (MEM-1); none when there is no file. */
export async function readMemory(home: string, project?: string): Promise<string[]> {
  const text = await readFile(memoryFile(home, project), 'utf8').catch(() => '')
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
}

/** The prompt's memory section (MEM-2, MEM-3), or nothing. */
export function memorySection(facts: string[], project?: { root: string; facts: string[] }): string {
  const cut = (fs: string[]) => {
    const text = fs.map((f) => `- ${f}`).join('\n')
    return text.length > MAX_MEMORY ? `${text.slice(0, MAX_MEMORY)}\n…[memory truncated]` : text
  }
  return [
    ...(facts.length ? ['', 'What you remember about the user (they wrote or approved each line; use it when it helps, never recite it):', cut(facts)] : []),
    // MEM-15: the project's after the user's, saying which project.
    ...(project?.facts.length ? ['', `What you remember about the project at ${project.root} (the user wrote or approved each line):`, cut(project.facts)] : []),
  ].join('\n')
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

async function save(home: string, facts: string[], project?: string) {
  const file = memoryFile(home, project)
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(`${file}.tmp`, facts.map((f) => `- ${f}\n`).join(''), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
  await chmod(file, 0o600)
}

/** Adds a fact; why not, or nothing when it was added. */
export async function addFact(home: string, fact: string, project?: string): Promise<string | undefined> {
  const facts = await readMemory(home, project)
  const problem = checkFact(fact, facts)
  if (problem) return problem
  await save(home, [...facts, fact.trim()], project)
}

/**
 * Removes the fact numbered `which` (from 1), or the one fact containing
 * those words (MEM-11): the fact removed, or the matches when not exactly one.
 */
export async function forgetFact(home: string, which: string, project?: string): Promise<{ removed: string } | { matches: string[] }> {
  const facts = await readMemory(home, project)
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
  await save(home, facts, project)
  return { removed }
}
