import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promptFrom, startsFresh } from '../src/args.ts'
import { makeTools } from '../src/tools.ts'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'navi-'))
  await writeFile(join(dir, 'a.txt'), 'hello')
  await mkdir(join(dir, 'sub'))
  return dir
}

// CLI-1
test('-p is the prompt, and bare words are reported as stray', () => {
  assert.deepEqual(promptFrom(['-p', 'list the files']), { prompt: 'list the files', stray: [] })
  assert.deepEqual(promptFrom(['list', 'the', 'files']), { prompt: null, stray: ['list', 'the', 'files'] })
  assert.deepEqual(promptFrom(['-p', '']), { prompt: null, stray: [] })
})

test('reports no prompt when given nothing', () => {
  assert.deepEqual(promptFrom([]), { prompt: null, stray: [] })
})

// SES-3
test('bare navi starts fresh, a prompt continues, --resume continues', () => {
  assert.equal(startsFresh({ prompt: null, resume: false }), true)
  assert.equal(startsFresh({ prompt: 'hi', resume: false }), false)
  assert.equal(startsFresh({ prompt: null, resume: true }), false)
})

test('read_file returns the contents of a real file, numbered by line', async () => {
  const dir = await fixture()
  const tools = makeTools({ approve: async () => true })

  const out = await tools.read_file.execute!({ path: join(dir, 'a.txt') } as any, {} as any)

  assert.equal(out, '1→hello')
})

test('list_dir lists real entries', async () => {
  const dir = await fixture()
  const tools = makeTools({ approve: async () => true })

  const out = (await tools.list_dir.execute!({ path: dir } as any, {} as any)) as string

  assert.deepEqual(out.split('\n').sort(), ['a.txt', 'sub'])
})

test('run_shell runs the command once approved', async () => {
  const tools = makeTools({ approve: async () => true })

  const out = (await tools.run_shell.execute!({ command: 'echo hi' } as any, {} as any)) as string

  assert.equal(out.trim(), 'hi')
})

test('run_shell refuses and reports back when approval is declined', async () => {
  const asked: string[] = []
  const tools = makeTools({
    approve: async (cmd) => {
      asked.push(cmd)
      return false
    },
  })

  const out = (await tools.run_shell.execute!(
    { command: 'rm -rf /' } as any,
    {} as any,
  )) as string

  assert.deepEqual(asked, ['rm -rf /'])
  assert.match(out, /declined/i)
})

test('every shell command is asked about separately', async () => {
  const asked: string[] = []
  const tools = makeTools({
    approve: async (cmd) => {
      asked.push(cmd)
      return true
    },
  })

  await tools.run_shell.execute!({ command: 'echo one' } as any, {} as any)
  await tools.run_shell.execute!({ command: 'echo one' } as any, {} as any)

  assert.deepEqual(asked, ['echo one', 'echo one'])
})
