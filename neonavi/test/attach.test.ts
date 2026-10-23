import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, splitUserContent, userContent } from '../src/attach.ts'
import { commandFrom, unshell } from '../src/args.ts'
import { estimateTokens } from '../src/compact.ts'

/** A one-page PDF whose only text is `words`, with a correct xref table. */
function pdf(words: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${words}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

async function dir() {
  const d = await mkdtemp(join(tmpdir(), 'navi-a-'))
  await writeFile(join(d, 'dot.png'), PNG)
  await writeFile(join(d, 'notes.md'), '# Notes\nbuy milk\n')
  await writeFile(join(d, 'paper.pdf'), pdf('Attention is all you need'))
  await writeFile(join(d, 'blob.bin'), Buffer.from([0, 1, 2, 255]))
  await mkdir(join(d, 'sub'))
  return d
}

// HAR-7
test('an image is attached as an image, a PDF and a text file as text', async () => {
  const d = await dir()
  assert.deepEqual(await attach('dot.png', d), { kind: 'image', name: 'dot.png', mediaType: 'image/png', data: PNG.toString('base64') })
  assert.deepEqual(await attach('notes.md', d), { kind: 'text', name: 'notes.md', text: '# Notes\nbuy milk\n' })
  const paper = await attach(join(d, 'paper.pdf'))
  assert.equal(paper.kind, 'text')
  assert.match((paper as any).text, /\[page 1\]\nAttention is all you need/)
})

test('what cannot be attached is refused by name', async () => {
  const d = await dir()
  await assert.rejects(attach('gone.txt', d), /gone\.txt: no such file/)
  await assert.rejects(attach('~/surely-not-here-navi.txt', d), (e: Error) => !e.message.includes(d))
  await assert.rejects(attach('sub', d), /sub is a directory/)
  await assert.rejects(attach('blob.bin', d), /blob\.bin is neither text, a PDF, nor a PNG/)
})

// HAR-7: a PDF with no text layer is scanned pages, shown as images where they can be drawn.
test('a PDF without text is sent as page images, or refused where pages cannot be drawn', async () => {
  const d = await dir()
  await writeFile(join(d, 'scan.pdf'), pdf(''))
  if (process.platform !== 'darwin') return assert.rejects(attach('scan.pdf', d), /scan\.pdf has no text to read/)
  const a = await attach('scan.pdf', d)
  assert.equal(a.kind, 'pages')
  if (a.kind !== 'pages') return
  assert.equal(a.of, 1)
  assert.deepEqual([...Buffer.from(a.pages[0], 'base64').subarray(0, 3)], [0xff, 0xd8, 0xff])
  const content = userContent('read it', [a]) as any[]
  const [block, prompt, page] = content
  assert.equal(block.text + prompt.text, '<image name="scan.pdf" pages="1" />\n\nread it')
  assert.deepEqual([page.type, page.mediaType, page.filename], ['file', 'image/jpeg', 'scan.pdf page 1'])
  assert.deepEqual(splitUserContent(content), { prompt: 'read it', names: ['scan.pdf'] })
})

test('only the first eight pages of a long scan are sent, and the model is told', () => {
  const [block, , ...pages] = userContent('read it', [{ kind: 'pages', name: 'long.pdf', mediaType: 'image/jpeg', pages: Array(8).fill('QQ=='), of: 30 }]) as any[]
  assert.equal(block.text, '<image name="long.pdf" pages="the first 8 of 30" />\n\n')
  assert.equal(pages.length, 8)
})

test('a long text file is cut and marked', async () => {
  const d = await dir()
  await writeFile(join(d, 'big.txt'), 'x'.repeat(100_010))
  const a = await attach('big.txt', d)
  assert.match((a as any).text, /^x{100000}\n…\[truncated\]$/)
})

test('the prompt goes after text files and before images, each named', async () => {
  const content = userContent('compare them', [
    { kind: 'text', name: 'a.md', text: 'alpha' },
    { kind: 'image', name: 'b.png', mediaType: 'image/png', data: 'QQ==' },
  ])
  assert.deepEqual(content, [
    { type: 'text', text: '<file name="a.md">\nalpha\n</file>\n\n' },
    { type: 'text', text: '<image name="b.png" />\n\n' },
    { type: 'text', text: 'compare them' },
    { type: 'file', mediaType: 'image/png', data: 'QQ==', filename: 'b.png' },
  ])
  assert.equal(userContent('just this'), 'just this')
})

// HAR-8
test('an image counts as a thousand tokens, whatever its size', () => {
  const big = 'A'.repeat(400_000)
  const tokens = estimateTokens([{ role: 'user', content: userContent('hi', [{ kind: 'image', name: 'p.png', mediaType: 'image/png', data: big }]) as any }])
  assert.ok(tokens > 1000 && tokens < 1100, String(tokens))
})

// CLI-19, CLI-23
test('/attach takes a path as typed, quoted or dropped with escapes', () => {
  assert.deepEqual(commandFrom('/attach ~/a.png'), { name: 'attach', path: '~/a.png' })
  assert.deepEqual(commandFrom("/attach '/Users/me/My Photo.png'"), { name: 'attach', path: '/Users/me/My Photo.png' })
  assert.equal(unshell('/Users/me/My\\ Photo\\ \\(1\\).png'), '/Users/me/My Photo (1).png')
  assert.deepEqual(commandFrom('/attach '), { name: 'attach', path: '' })
})

// HAR-8, RAY-11: a stored turn is shown as its prompt and the names of what came with it.
test("a user message's prompt and attachment names come back out of it", () => {
  const content = userContent('what\n</file>\n\nnow', [
    { kind: 'text', name: 'a.md', text: 'x\n</file>\n\n<file name="fake">\nend' },
    { kind: 'image', name: 'p.png', mediaType: 'image/png', data: '' },
  ]) as any[]
  assert.deepEqual(splitUserContent(content), { prompt: 'what\n</file>\n\nnow', names: ['a.md', 'p.png'] })
  assert.deepEqual(splitUserContent('<file name="x">\ntyped\n</file>\n\nby hand'), { prompt: '<file name="x">\ntyped\n</file>\n\nby hand', names: [] })
  assert.deepEqual(splitUserContent([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }]), { prompt: 'onetwo', names: [] })
})

// HAR-7: refused before it is read whole.
test('a file over 50 MB is refused, naming it', async () => {
  const d = await dir()
  const { truncate } = await import('node:fs/promises')
  await writeFile(join(d, 'huge.log'), '')
  await truncate(join(d, 'huge.log'), 51 * 1024 * 1024)
  await assert.rejects(attach('huge.log', d), /^Error: huge\.log is 51 MB; navi attaches files up to 50 MB$/)
})
