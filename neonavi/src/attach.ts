import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { FilePart, ImagePart, TextPart } from 'ai'

const run = promisify(execFile)

/** A file read for a turn (HAR-7): an image to show, or text to read. */
export type Attachment =
  | { kind: 'image'; name: string; mediaType: string; data: string }
  | { kind: 'text'; name: string; text: string }

const IMAGES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const MAX_TEXT = 100_000
const MAX_SIDE = 1600
/** Read whole before anything else, so a stray video or disk image is refused first. */
const MAX_FILE = 50 * 1024 * 1024
/** What one image may still weigh once scaled: more is a request no server takes. */
const MAX_IMAGE = 20 * 1024 * 1024
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

function cut(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[truncated]` : text
}

/**
 * A large photo costs the model as much as a page of text and the request
 * megabytes, so it is scaled down first where the system can (HAR-7). An
 * animated GIF is left alone, since scaling keeps only its first frame.
 */
async function scaled(file: string, ext: string, bytes: Buffer): Promise<Buffer> {
  if (process.platform !== 'darwin' || ext === '.gif') return bytes
  try {
    const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file])
    const sides = [...stdout.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) => Number(m[1]))
    if (sides.length < 2 || Math.max(...sides) <= MAX_SIDE) return bytes
    const dir = await mkdtemp(join(tmpdir(), 'navi-attach-'))
    try {
      const out = join(dir, `scaled${ext}`)
      await run('sips', ['-Z', String(MAX_SIDE), file, '--out', out])
      return await readFile(out)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  } catch {
    return bytes
  }
}

async function pdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: false })
  return text.map((page, i) => `[page ${i + 1}]\n${page.trim()}`).join('\n\n')
}

/** Reads one file for a turn, or throws an Error whose message names it (HAR-7). */
export async function attach(path: string, cwd = process.cwd()): Promise<Attachment> {
  // Typed at the prompt, `~` has no shell to expand it.
  const file = resolve(cwd, path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path)
  const name = basename(file)
  const info = await stat(file).catch(() => null)
  if (!info) throw new Error(`${path}: no such file`)
  if (info.isDirectory()) throw new Error(`${path} is a directory; attach the files in it instead`)
  if (info.size > MAX_FILE) throw new Error(`${path} is ${mb(info.size)}; navi attaches files up to ${mb(MAX_FILE)}`)
  const ext = extname(file).toLowerCase()
  const bytes = await readFile(file)
  if (IMAGES[ext]) {
    const image = await scaled(file, ext, bytes)
    if (image.length > MAX_IMAGE) throw new Error(`${path} is ${mb(image.length)} even scaled down; navi sends images up to ${mb(MAX_IMAGE)}`)
    return { kind: 'image', name, mediaType: IMAGES[ext], data: image.toString('base64') }
  }
  if (ext === '.pdf') {
    const text = await pdfText(bytes).catch(() => '')
    if (!text.replace(/\[page \d+\]/g, '').trim())
      throw new Error(`${path} has no text to read; it may be scanned pages, which navi cannot read yet`)
    return { kind: 'text', name, text: cut(text) }
  }
  const text = bytes.toString('utf8')
  if (text.includes('\u0000') || text.includes('�'))
    throw new Error(`${path} is neither text, a PDF, nor a PNG, JPEG, GIF or WebP image`)
  return { kind: 'text', name, text: cut(text) }
}

/** The user message for a prompt and its attachments: text files first, then the prompt, then images. */
export function userContent(prompt: string, attachments: Attachment[] = []): string | (TextPart | ImagePart | FilePart)[] {
  if (!attachments.length) return prompt
  // Images are named too, so the model can tell which is which.
  const texts = attachments.map((a) =>
    a.kind === 'text' ? `<file name="${a.name}">\n${a.text}\n</file>` : `<image name="${a.name}" />`,
  )
  const images = attachments.flatMap((a): FilePart[] =>
    a.kind === 'image' ? [{ type: 'file', mediaType: a.mediaType, data: a.data, filename: a.name }] : [],
  )
  return [{ type: 'text', text: [...texts, prompt].join('\n\n') }, ...images]
}

/**
 * The prompt and attachment names back out of a user message's text as
 * userContent wrote it, for showing a stored turn without the files' text.
 */
export function splitUserText(text: string): { prompt: string; names: string[] } {
  if (!/^<(file|image) name="/.test(text)) return { prompt: text, names: [] }
  // The prompt follows the last block, however much a file's own text looks like one.
  const ends = [...text.matchAll(/\n<\/file>\n\n|<image name="[^"]*" \/>\n\n/g)]
  const last = ends.at(-1)
  if (!last) return { prompt: text, names: [] }
  const head = text.slice(0, last.index + last[0].length)
  const names = [...head.matchAll(/(?:^|<\/file>\n\n|" \/>\n\n)<(?:file|image) name="([^"]*)"/g)].map((m) => m[1])
  return { prompt: text.slice(head.length), names }
}
