import { execFile } from 'node:child_process'
import { access, constants, open, readFile, readdir, stat } from 'node:fs/promises'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

/**
 * grep and glob behind one interface, so the tools never care which ran:
 * ripgrep when it is installed, and a built-in walk otherwise (TL-31). Raycast
 * runs in its own bundled Node, where rg is almost never on PATH.
 */
export interface Search {
  /** `shown:line:text` for every matching line, `shown` being `path` joined with the file. */
  grep: (pattern: string, path: string) => Promise<string[]>
  /** One path per line, for every file whose path matches the glob. */
  files: (glob: string, path: string) => Promise<string[]>
}

export interface SearchOptions {
  /** Relative search paths resolve against this. */
  cwd?: string
  /** false forces the built-in search even where rg is installed. */
  ripgrep?: boolean
}

export function makeSearch({ cwd = process.cwd(), ripgrep }: SearchOptions = {}): Search {
  // NEONAVI_RIPGREP=0 runs the built-in path everywhere, e.g. the search suite.
  const allowed = ripgrep ?? process.env.NEONAVI_RIPGREP !== '0'
  const viaRg = async () => allowed && (await hasRipgrep())
  return {
    grep: async (pattern, path) =>
      (await viaRg())
        ? rg(['--line-number', '--with-filename', pattern, path], cwd)
        : builtinGrep(pattern, path, cwd),
    // rg's own -g would whitelist ignored and hidden files that match it, so
    // the glob is applied here, to what rg lists, the same way in both paths.
    files: async (glob, path) =>
      (await viaRg())
        ? matching(glob, path, cwd, (await rg(['--files', path], cwd)).map((shown) => ({ abs: resolve(cwd, shown), shown })))
        : matching(glob, path, cwd, walk(path, cwd)),
  }
}

let found: Promise<boolean> | null = null

/** Looked up on PATH once rather than spawned: a failed spawn per search is slow. */
export function hasRipgrep(): Promise<boolean> {
  return (found ??= (async () => {
    const names = process.platform === 'win32' ? ['rg.exe', 'rg.cmd'] : ['rg']
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean))
      for (const name of names)
        if (await access(join(dir, name), constants.X_OK).then(() => true, () => false)) return true
    return false
  })())
}

async function rg(args: string[], cwd: string): Promise<string[]> {
  // .gitignore covers these in a real project, but not in a directory that has
  // no .gitignore — and dependency hits are never the answer either way.
  const never = ['-g', '!node_modules', '-g', '!.git']
  try {
    const { stdout } = await runFile('rg', [...never, ...args], { cwd, maxBuffer: 1 << 24 })
    return stdout.split('\n').filter(Boolean)
  } catch (e: any) {
    // rg exits 1 with no output when nothing matched; that is not an error.
    if (e.code === 1 && !e.stderr) return []
    throw e
  }
}

// ---------------------------------------------------------------------------
// Built-in search: what rg does by default, minus the speed.

/** Never searched, whatever any ignore file says (TL-5). */
const NEVER = new Set(['node_modules', '.git'])
/** rg calls a file binary on a NUL byte early on and skips it when walking. */
const SNIFF = 8000
const BATCH = 32

interface Rule {
  re: RegExp
  negate: boolean
  dirOnly: boolean
}

/** One ignore file's rules, matched against paths relative to `base`. */
interface Rules {
  base: string
  rules: Rule[]
}

/**
 * A gitignore pattern as a regex over a `/`-separated path relative to the
 * file's directory. Supports comments, `!` negation, `\` escapes, trailing `/`
 * for directories only, anchoring by a leading or inner `/`, `*`, `?`, `**`
 * and `[...]` classes. `braces` adds `{a,b}`, which rg's -g globs accept and
 * gitignore does not.
 */
export function compilePattern(line: string, braces = false): Rule | null {
  let p = line.replace(/(?<!\\)\s+$/, '')
  if (!p || p.startsWith('#')) return null
  let negate = false
  if (p.startsWith('!')) {
    negate = true
    p = p.slice(1)
  } else if (p.startsWith('\\!') || p.startsWith('\\#')) p = p.slice(1)
  let dirOnly = false
  if (p.endsWith('/')) {
    dirOnly = true
    p = p.replace(/\/+$/, '')
  }
  if (!p) return null
  // A slash anywhere but the end pins the pattern to the file's directory;
  // without one it matches a name at any depth.
  const anchored = p.includes('/')
  p = p.replace(/^\//, '')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') {
      if (p[i + 1] === '*') {
        const atStart = i === 0 || p[i - 1] === '/'
        const atEnd = i + 2 === p.length || p[i + 2] === '/'
        if (atStart && atEnd) {
          // `**/` is any number of directories, `/**` everything inside.
          if (i + 2 === p.length) re += '.*'
          else re += '(?:.*/)?'
          i += 2
          continue
        }
        i++
      }
      re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '\\' && i + 1 < p.length) re += escape(p[++i])
    else if (c === '[') {
      const end = p.indexOf(']', i + 2)
      if (end === -1) re += '\\['
      else {
        let body = p.slice(i + 1, end)
        if (body.startsWith('!')) body = `^${body.slice(1)}`
        re += `[${body}]`
        i = end
      }
    } else if (braces && c === '{') {
      const end = p.indexOf('}', i)
      if (end === -1) re += '\\{'
      else {
        const alts = p.slice(i + 1, end).split(',').map((a) => compilePattern(`/${a}`)?.re.source.slice(1, -1) ?? '')
        re += `(?:${alts.join('|')})`
        i = end
      }
    } else re += escape(c)
  }
  return { re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`), negate, dirOnly }
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function parseIgnore(text: string): Rule[] {
  return text.split(/\r?\n/).map((l) => compilePattern(l)).filter((r): r is Rule => r !== null)
}

/** The last rule that matches decides, deepest file last, as git does. */
function ignored(stack: Rules[], abs: string, isDir: boolean): boolean {
  let out = false
  for (const { base, rules } of stack) {
    const rel = toPosix(relative(base, abs))
    if (!rel || rel.startsWith('..')) continue
    for (const r of rules) if ((!r.dirOnly || isDir) && r.re.test(rel)) out = !r.negate
  }
  return out
}

const toPosix = (p: string) => (sep === '/' ? p : p.split(sep).join('/'))

async function readRules(file: string, base: string): Promise<Rules | null> {
  const text = await readFile(file, 'utf8').catch(() => null)
  return text === null ? null : { base, rules: parseIgnore(text) }
}

const exists = (p: string) => stat(p).then(() => true, () => false)

/**
 * The ignore files that apply above the search root: `.gitignore` from the
 * repo root down (and the repo's `.git/info/exclude`), `.ignore` all the way
 * up. Outside a git repo `.gitignore` means nothing, as with git and rg.
 */
async function ancestorRules(root: string): Promise<{ git: Rules[]; plain: Rules[]; repo: boolean }> {
  const dirs: string[] = []
  let repoRoot: string | null = null
  for (let d = dirname(root); ; d = dirname(d)) {
    dirs.unshift(d)
    if (!repoRoot && (await exists(join(d, '.git')))) repoRoot = d
    if (dirname(d) === d) break
  }
  const git: Rules[] = []
  const plain: Rules[] = []
  if (repoRoot) {
    const exclude = await readRules(join(repoRoot, '.git', 'info', 'exclude'), repoRoot)
    if (exclude) git.push(exclude)
  }
  for (const d of dirs) {
    const ig = await readRules(join(d, '.ignore'), d)
    if (ig) plain.push(ig)
    if (repoRoot && (d === repoRoot || d.startsWith(repoRoot + sep))) {
      const gi = await readRules(join(d, '.gitignore'), d)
      if (gi) git.push(gi)
    }
  }
  return { git, plain, repo: repoRoot !== null }
}

interface Hit {
  abs: string
  shown: string
}

/** Files under `path`, sorted, with what rg would print for each. */
async function* walk(path: string, cwd: string): AsyncGenerator<Hit> {
  const root = resolve(cwd, path)
  const info = await stat(root)
  if (!info.isDirectory()) {
    yield { abs: root, shown: path }
    return
  }
  const prefix = path.endsWith('/') ? path : `${path}/`
  const above = await ancestorRules(root)

  async function* visit(dir: string, shown: string, git: Rules[], plain: Rules[], repo: boolean): AsyncGenerator<Hit> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    // A nested repo starts its own ignore rules; its parent's do not reach in.
    if (entries.some((e) => e.name === '.git')) {
      const exclude = await readRules(join(dir, '.git', 'info', 'exclude'), dir)
      git = exclude ? [exclude] : []
      repo = true
    }
    if (repo) {
      const gi = await readRules(join(dir, '.gitignore'), dir)
      if (gi) git = [...git, gi]
    }
    const ig = await readRules(join(dir, '.ignore'), dir)
    if (ig) plain = [...plain, ig]
    const stack = [...git, ...plain]
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      // Hidden entries are skipped like rg does; symlinks are not followed.
      if (e.name.startsWith('.') || NEVER.has(e.name) || e.isSymbolicLink()) continue
      const abs = join(dir, e.name)
      const isDir = e.isDirectory()
      if (!isDir && !e.isFile()) continue
      if (ignored(stack, abs, isDir)) continue
      if (isDir) yield* visit(abs, `${shown}${e.name}/`, git, plain, repo)
      else yield { abs, shown: `${shown}${e.name}` }
    }
  }

  yield* visit(root, prefix, above.git, above.plain, above.repo)
}

/** rg's regex dialect is close enough to JS's; `(?i)` is the common difference. */
export function toRegExp(pattern: string): RegExp {
  let flags = ''
  let p = pattern
  if (p.startsWith('(?i)')) {
    flags = 'i'
    p = p.slice(4)
  }
  try {
    return new RegExp(p, flags)
  } catch {
    // A pattern JS cannot parse is most likely meant literally.
    return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  }
}

async function isBinary(file: string): Promise<boolean> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(SNIFF)
    const { bytesRead } = await fh.read(buf, 0, SNIFF, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}

async function grepFile(file: Hit, re: RegExp): Promise<string[]> {
  try {
    if (await isBinary(file.abs)) return []
    const lines = (await readFile(file.abs, 'utf8')).split('\n')
    if (lines.at(-1) === '') lines.pop()
    const out: string[] = []
    for (const [i, raw] of lines.entries()) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (re.test(line)) out.push(`${file.shown}:${i + 1}:${line}`)
    }
    return out
  } catch {
    // Unreadable files are skipped, as rg does after a warning.
    return []
  }
}

export async function builtinGrep(pattern: string, path: string, cwd: string): Promise<string[]> {
  const re = toRegExp(pattern)
  const hits: string[] = []
  let batch: Hit[] = []
  const flush = async () => {
    // Read in parallel, report in walk order.
    for (const lines of await Promise.all(batch.map((f) => grepFile(f, re)))) hits.push(...lines)
    batch = []
  }
  for await (const f of walk(path, cwd)) {
    batch.push(f)
    if (batch.length >= BATCH) await flush()
  }
  await flush()
  return hits
}

async function matching(glob: string, path: string, cwd: string, files: Iterable<Hit> | AsyncIterable<Hit>): Promise<string[]> {
  const rule = compilePattern(glob, true)
  if (!rule) return []
  const root = resolve(cwd, path)
  const out: string[] = []
  for await (const f of files) {
    // A file passed as the path is matched by its own name.
    const rel = toPosix(relative(root, f.abs)) || f.abs.split(sep).pop()!
    // A glob selects files, and `!glob` turns it into an exclusion, as in rg's -g.
    if (rule.re.test(rel) !== rule.negate) out.push(f.shown)
  }
  return out
}
