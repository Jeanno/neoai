import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTools } from '../src/tools.ts'

const tools = makeTools({ approve: async () => false })
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

test('grep reports the file and line of each match', async () => {
  const out = await call(tools.grep, { pattern: 'needle', path: await repo() })

  assert.match(out, /alpha\.ts:1:/)
  assert.match(out, /beta\.ts:1:/)
})

test('grep leaves out files that do not match', async () => {
  const out = await call(tools.grep, { pattern: 'needle', path: await repo() })

  assert.doesNotMatch(out, /notes\.md/)
})

// A naive grep here returns thousands of dependency hits and buries the answer.
test('grep skips node_modules', async () => {
  const out = await call(tools.grep, { pattern: 'needle', path: await repo() })

  assert.doesNotMatch(out, /node_modules/)
})

test('grep says so plainly when nothing matches', async () => {
  const out = await call(tools.grep, { pattern: 'zzz-nothing', path: await repo() })

  assert.match(out, /no matches/i)
})

test('glob finds files by name pattern', async () => {
  const out = await call(tools.glob, { pattern: '*.ts', path: await repo() })

  assert.match(out, /alpha\.ts/)
  assert.match(out, /beta\.ts/)
  assert.doesNotMatch(out, /notes\.md/)
})

test('glob says so plainly when nothing matches', async () => {
  const out = await call(tools.glob, { pattern: '*.rs', path: await repo() })

  assert.match(out, /no files/i)
})
