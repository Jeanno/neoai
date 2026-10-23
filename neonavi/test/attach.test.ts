import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, userContent } from '../src/attach.ts'
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
  await writeFile(join(d, 'empty.pdf'), pdf(''))
  await assert.rejects(attach('empty.pdf', d), /empty\.pdf has no text to read/)
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
    { type: 'text', text: '<file name="a.md">\nalpha\n</file>\n\n<image name="b.png" />\n\ncompare them' },
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
  assert.equal(commandFrom('/attach '), null)
})
