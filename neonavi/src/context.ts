import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const CONTEXT_FILE = 'NAVI.md'
export const MAX_CONTEXT = 8000

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/**
 * Walks up from the working directory to the repo root, collecting every
 * NAVI.md and returning them root-first — so running navi inside one package of
 * a monorepo gets the repo's context as well as the package's. It stops at the
 * repo root because a NAVI.md above that belongs to a different project.
 *
 * This is the cure for answers invented from directory names: the model
 * confabulates when nothing in the tree says what the code is for.
 */
export async function collectContext(cwd: string, stopAt = homedir()): Promise<string> {
  const found: { dir: string; text: string }[] = []

  for (let dir = cwd; ; dir = dirname(dir)) {
    const file = join(dir, CONTEXT_FILE)
    if (await exists(file)) found.unshift({ dir, text: await readFile(file, 'utf8') })
    // Home is a boundary too: outside a repo, climbing to / would otherwise
    // pull in a stray NAVI.md that has nothing to do with the task at hand.
    if ((await exists(join(dir, '.git'))) || dir === stopAt || dirname(dir) === dir) break
  }

  if (!found.length) return ''
  const joined = found.map((f) => `# ${join(f.dir, CONTEXT_FILE)}\n${f.text.trim()}`).join('\n\n')
  return joined.length > MAX_CONTEXT ? `${joined.slice(0, MAX_CONTEXT)}\n…[context truncated]` : joined
}
