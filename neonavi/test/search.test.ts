import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTools } from '../src/tools.ts'
import { compilePattern, hasRipgrep, makeSearch } from '../src/search.ts'

const call = (t: any, args: any) => t.execute!(args, {} as any) as Promise<string>

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'navi-g-'))
  await writeFile(join(dir, 'alpha.ts'), 'export const needle = 1\nconst other = 2\n')
  await writeFile(join(dir, 'beta.ts'), 'import { needle } from "./alpha.ts"\n')
  await writeFile(join(dir, 'notes.md'), 'no match here\n')
  await mkdir(join(dir, 'node_modules', 'junk'), { recursive: true })
  await writeFile(join(dir, 'node_modules', 'junk', 'x.ts'), 'needle needle needle\n')
  return dir
}

/** A git repo with root and nested .gitignore files, hidden files and a negation. */
async function ignoring() {
  const dir = await repo()
  await mkdir(join(dir, '.git'))
  await writeFile(join(dir, '.gitignore'), '# build output\ndist/\n*.log\n!keep.log\n/rooted.ts\n')
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist', 'out.ts'), 'needle\n')
  await writeFile(join(dir, 'debug.log'), 'needle\n')
  await writeFile(join(dir, 'keep.log'), 'needle\n')
  await writeFile(join(dir, 'rooted.ts'), 'needle\n')
  await writeFile(join(dir, '.hidden.ts'), 'needle\n')
  await mkdir(join(dir, '.cache'))
  await writeFile(join(dir, '.cache', 'c.ts'), 'needle\n')
  await mkdir(join(dir, 'pkg', 'gen'), { recursive: true })
  await writeFile(join(dir, 'pkg', '.gitignore'), 'gen\nsecret-*.ts\n')
  await writeFile(join(dir, 'pkg', 'gen', 'g.ts'), 'needle\n')
  await writeFile(join(dir, 'pkg', 'secret-a.ts'), 'needle\n')
  await writeFile(join(dir, 'pkg', 'rooted.ts'), 'needle\n')
  await writeFile(join(dir, 'pkg', 'main.ts'), 'needle\n')
  return dir
}

// Every case runs on the built-in search, and on rg too where it is installed (TL-31).
for (const ripgrep of [true, false]) {
  describe(ripgrep ? 'search via ripgrep when installed' : 'built-in search', () => {
    const tools = makeTools({ approve: async () => false }, { ripgrep })

    // TL-6
    test('grep reports the file and line of each match', async () => {
      const out = await call(tools.grep, { pattern: 'needle', path: await repo() })

      assert.match(out, /alpha\.ts:1:export const needle = 1/)
      assert.match(out, /beta\.ts:1:/)
    })

    test('grep leaves out files that do not match', async () => {
      const out = await call(tools.grep, { pattern: 'needle', path: await repo() })

      assert.doesNotMatch(out, /notes\.md/)
    })

    // TL-5. A naive grep here returns thousands of dependency hits and buries the answer.
    test('grep skips node_modules', async () => {
      const out = await call(tools.grep, { pattern: 'needle', path: await repo() })

      assert.doesNotMatch(out, /node_modules/)
    })

    // TL-7
    test('grep says so plainly when nothing matches', async () => {
      const out = await call(tools.grep, { pattern: 'zzz-nothing', path: await repo() })

      assert.match(out, /no matches/i)
    })

    // TL-6
    test('glob finds files by name pattern', async () => {
      const out = await call(tools.glob, { pattern: '*.ts', path: await repo() })

      assert.match(out, /alpha\.ts/)
      assert.match(out, /beta\.ts/)
      assert.doesNotMatch(out, /notes\.md/)
      assert.doesNotMatch(out, /node_modules/)
    })

    // TL-7
    test('glob says so plainly when nothing matches', async () => {
      const out = await call(tools.glob, { pattern: '*.rs', path: await repo() })

      assert.match(out, /no files/i)
    })

    // TL-31
    test('grep honours root and nested .gitignore files and skips hidden files', async () => {
      const dir = await ignoring()
      const out = await call(tools.grep, { pattern: 'needle', path: dir })
      const files = new Set(out.split('\n').map((l) => l.slice(dir.length + 1).split(':')[0]))

      assert.deepEqual(
        [...files].sort(),
        ['alpha.ts', 'beta.ts', 'keep.log', 'pkg/main.ts', 'pkg/rooted.ts'],
      )
    })

    // TL-31
    test('glob honours .gitignore and skips hidden files', async () => {
      const dir = await ignoring()
      const out = await call(tools.glob, { pattern: '*.ts', path: dir })
      const files = out.split('\n').map((l) => l.slice(dir.length + 1))

      assert.deepEqual(files.sort(), ['alpha.ts', 'beta.ts', 'pkg/main.ts', 'pkg/rooted.ts'])
    })

    // TL-31: outside a git repo .gitignore means nothing, as with git itself.
    test('a .gitignore outside a git repo is not applied', async () => {
      const dir = await repo()
      await writeFile(join(dir, '.gitignore'), 'beta.ts\n')
      const out = await call(tools.glob, { pattern: '*.ts', path: dir })

      assert.match(out, /beta\.ts/)
    })

    // TL-8
    test('path defaults to the working directory', async () => {
      const dir = await repo()
      const here = makeTools({ approve: async () => false }, { ripgrep, cwd: dir })

      assert.deepEqual((await call(here.grep, { pattern: 'const needle' })).split('\n'), [
        './alpha.ts:1:export const needle = 1',
      ])
      assert.deepEqual((await call(here.glob, { pattern: 'alpha*' })).split('\n'), ['./alpha.ts'])
    })

    test('glob matches a pattern with a directory in it from the search root', async () => {
      const dir = await ignoring()
      const out = await call(tools.glob, { pattern: 'pkg/*.ts', path: dir })

      assert.deepEqual(out.split('\n').map((l) => l.slice(dir.length + 1)).sort(), ['pkg/main.ts', 'pkg/rooted.ts'])
    })

    // TL-2
    test('grep and glob stop at 100 hits and say how many were dropped', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'navi-many-'))
      for (let i = 0; i < 105; i++) await writeFile(join(dir, `f${i}.txt`), 'hit\n')

      assert.match(await call(tools.grep, { pattern: 'hit', path: dir }), /…\[5 more matches not shown\]$/)
      assert.match(await call(tools.glob, { pattern: '*.txt', path: dir }), /…\[5 more files not shown\]$/)
    })
  })
}

// TL-31: same results either way.
test('the built-in search finds what rg finds', async (t) => {
  if (!(await hasRipgrep())) return t.skip('rg is not installed')
  const dir = await ignoring()
  for (const [glob, pattern] of [['*.ts', 'needle'], ['**/*.log', 'ne+dle'], ['{alpha,beta}.ts', '^import']]) {
    const viaRg = makeSearch({ cwd: dir, ripgrep: true })
    const builtin = makeSearch({ cwd: dir, ripgrep: false })
    assert.deepEqual((await builtin.grep(pattern, '.')).sort(), (await viaRg.grep(pattern, '.')).sort())
    assert.deepEqual((await builtin.files(glob, '.')).sort(), (await viaRg.files(glob, '.')).sort())
  }
})

test('gitignore patterns: anchoring, directories only, ** and negation', () => {
  const m = (pattern: string, path: string) => compilePattern(pattern)!.re.test(path)

  assert.ok(m('*.log', 'a/b/x.log'))
  assert.ok(m('/top.ts', 'top.ts'))
  assert.ok(!m('/top.ts', 'sub/top.ts'))
  assert.ok(m('a/**/z', 'a/z'))
  assert.ok(m('a/**/z', 'a/b/c/z'))
  assert.ok(m('**/build', 'x/build'))
  assert.ok(m('lib/**', 'lib/deep/file'))
  assert.ok(m('file?.[ch]', 'dir/file1.c'))
  assert.ok(!m('file[!0-9].c', 'file1.c'))
  assert.equal(compilePattern('dist/')!.dirOnly, true)
  assert.equal(compilePattern('!keep.log')!.negate, true)
  assert.equal(compilePattern('# comment'), null)
  assert.ok(m('\\#hash', '#hash'))
  assert.ok(compilePattern('*.{ts,md}', true)!.re.test('x/y.md'))
})
