import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTools } from '../src/tools.ts'

const tools = makeTools({ approve: async () => false })
const read = (args: any) => tools.read_file.execute!(args, {} as any) as Promise<string>

async function file(lines: number) {
  const dir = await mkdtemp(join(tmpdir(), 'navi-r-'))
  const p = join(dir, 'big.ts')
  await writeFile(p, Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'))
  return p
}

// TL-9
test('numbers each line so the model can refer to one', async () => {
  const out = await read({ path: await file(3) })

  assert.equal(out.split('\n')[0], '1→line 1')
})

// TL-10
test('reads from an offset', async () => {
  const out = await read({ path: await file(100), offset: 50, limit: 2 })

  assert.equal(out.split('\n')[0], '50→line 50')
  assert.equal(out.split('\n')[1], '51→line 51')
})

// TL-10
test('limit bounds how many lines come back', async () => {
  const out = await read({ path: await file(100), offset: 1, limit: 5 })

  assert.equal(out.split('\n').filter((l) => l.includes('→')).length, 5)
})

// TL-3, TL-11: a 3000-line file used to be cut mid-token at 8000 characters with no way back.
test('a long file is cut by line and says how to see the rest', async () => {
  const out = await read({ path: await file(1000) })

  assert.match(out, /1→line 1/)
  assert.match(out, /400→line 400/)
  assert.doesNotMatch(out, /401→line 401/)
  assert.match(out, /offset/i)
})

test('a short file comes back whole with no footer', async () => {
  const out = await read({ path: await file(3) })

  assert.doesNotMatch(out, /offset/i)
})

// TL-11: a file of long lines hits the character budget before the 400-line limit.
// It must still say where to resume, not just "[truncated]".
test('a file cut by size still says how to see the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-r-'))
  const p = join(dir, 'wide.ts')
  await writeFile(p, Array.from({ length: 300 }, (_, i) => `${i}:${'x'.repeat(200)}`).join('\n'))

  const out = await read({ path: p })

  assert.match(out, /read again with offset \d+/)
  assert.doesNotMatch(out, /…\[truncated\]/)
})

// TL-45
test('an image is looked at, not read as text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'navi-r-'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await writeFile(join(dir, 'shot.png'), png)
  let shown: { question: string; mediaType?: string; bytes: number } | undefined
  const seeing = makeTools({ approve: async () => false }, {
    see: async (picture, question, _signal, mediaType) => {
      shown = { question, mediaType, bytes: picture.length }
      return 'a single dot'
    },
  })
  const out = await seeing.read_file.execute!({ path: join(dir, 'shot.png'), question: 'what colour?' }, {} as any)
  assert.match(String(out), /as it looks:\na single dot$/)
  assert.equal(shown?.mediaType, 'image/png')
  assert.equal(shown?.bytes, png.length)
  assert.match(shown!.question, /shot\.png\. what colour\?/)
  // With no way to see apart, the picture is the output; a model without sight is told so.
  const plain: any = await tools.read_file.execute!({ path: join(dir, 'shot.png') }, {} as any)
  assert.deepEqual(plain, { name: 'shot.png', mediaType: 'image/png', data: png.toString('base64') })
  assert.deepEqual((tools.read_file as any).toModelOutput(plain).value[1], { type: 'media', data: png.toString('base64'), mediaType: 'image/png' })
  const blind = makeTools({ approve: async () => false }, { look: false })
  assert.match(String(await blind.read_file.execute!({ path: join(dir, 'shot.png') }, {} as any)), /cannot see images/)
})
