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
  /** A PDF of scanned pages, each page an image; `of` is how many it has. */
  | { kind: 'pages'; name: string; mediaType: 'image/jpeg'; pages: string[]; of: number }

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

/** Pages past this are left out: each costs the model as much as an image. */
const MAX_PAGES = 8

/** A page over this is drawn smaller: providers refuse an image much past 5 MB. */
const MAX_PAGE = 4 * 1024 * 1024

/** Draws a PDF's first pages as JPEGs with PDFKit, from JavaScript for Automation: nothing to install. */
const RENDER = `ObjC.import('PDFKit'); ObjC.import('AppKit')
function run([file, dir, most, side, cap]) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(file))
  if (!doc || doc.isNil()) return '0'
  for (let i = 0; i < Math.min(doc.pageCount, Number(most)); i++) {
    const page = doc.pageAtIndex(i)
    const box = page.boundsForBox($.kPDFDisplayBoxMediaBox).size
    // A noisy scan can outweigh the cap at full size; each try is smaller.
    for (let longest = Number(side); ; longest = Math.round(longest * 0.7)) {
      const scale = longest / Math.max(box.width, box.height)
      const image = page.thumbnailOfSizeForBox($.NSMakeSize(Math.round(box.width * scale), Math.round(box.height * scale)), $.kPDFDisplayBoxMediaBox)
      const jpeg = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation)
        .representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG, $({ NSImageCompressionFactor: 0.75 }))
      if (jpeg.length <= Number(cap) || longest < 400) {
        jpeg.writeToFileAtomically(dir + '/' + (i + 1) + '.jpg', true)
        break
      }
    }
  }
  return String(doc.pageCount)
}`

/** A scanned PDF's pages as JPEGs, as many as fit in one image's allowance, or null where they cannot be drawn (HAR-7). */
async function pdfPages(file: string): Promise<{ pages: string[]; of: number } | null> {
  if (process.platform !== 'darwin') return null
  const dir = await mkdtemp(join(tmpdir(), 'navi-pages-'))
  try {
    const args = ['-l', 'JavaScript', '-e', RENDER, file, dir, String(MAX_PAGES), String(MAX_SIDE), String(MAX_PAGE)]
    // A pathological PDF must not hang the prompt.
    const { stdout } = await run('osascript', args, { timeout: 60_000 })
    const of = Number(stdout.trim())
    if (!of) return null
    const pages: string[] = []
    let total = 0
    for (let i = 1; i <= Math.min(of, MAX_PAGES); i++) {
      const page = await readFile(join(dir, `${i}.jpg`))
      total += page.length
      if (total > MAX_IMAGE && pages.length) break
      pages.push(page.toString('base64'))
    }
    return { pages, of }
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
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
    if (!text.replace(/\[page \d+\]/g, '').trim()) {
      // Scanned pages: shown to the model as the images they are.
      const drawn = await pdfPages(file)
      if (!drawn) throw new Error(`${path} has no text to read, and its pages could not be drawn as images here`)
      return { kind: 'pages', name, mediaType: 'image/jpeg', ...drawn }
    }
    return { kind: 'text', name, text: cut(text) }
  }
  const text = bytes.toString('utf8')
  if (text.includes('\u0000') || text.includes('�'))
    throw new Error(`${path} is neither text, a PDF, nor a PNG, JPEG, GIF or WebP image`)
  return { kind: 'text', name, text: cut(text) }
}

/**
 * The user message for a prompt and its attachments: text files first, then
 * the prompt, then images. Each file is a text part of its own and the prompt
 * the last, so a stored turn can be shown as what was asked (splitUserContent).
 */
export function userContent(prompt: string, attachments: Attachment[] = []): string | (TextPart | ImagePart | FilePart)[] {
  if (!attachments.length) return prompt
  // Images are named too, so the model can tell which is which.
  const blocks = attachments.map((a): TextPart => ({
    type: 'text',
    text:
      (a.kind === 'text'
        ? `<file name="${a.name}">\n${a.text}\n</file>`
        : a.kind === 'pages'
          ? `<image name="${a.name}" pages="${a.pages.length < a.of ? `the first ${a.pages.length} of ${a.of}` : a.of}" />`
          : `<image name="${a.name}" />`) + '\n\n',
  }))
  const images = attachments.flatMap((a): FilePart[] =>
    a.kind === 'image'
      ? [{ type: 'file', mediaType: a.mediaType, data: a.data, filename: a.name }]
      : a.kind === 'pages'
        ? a.pages.map((data, i) => ({ type: 'file', mediaType: a.mediaType, data, filename: `${a.name} page ${i + 1}` }))
        : [],
  )
  return [...blocks, { type: 'text', text: prompt }, ...images]
}

/** The prompt and attachment names back out of a user message userContent made, for showing a stored turn. */
export function splitUserContent(content: string | readonly { type: string; text?: string }[]): { prompt: string; names: string[] } {
  if (typeof content === 'string') return { prompt: content, names: [] }
  const texts = content.flatMap((p) => (p.type === 'text' && typeof p.text === 'string' ? [p.text] : []))
  const names = texts.slice(0, -1).flatMap((t) => /^<(?:file|image) name="([^"]*)"/.exec(t)?.[1] ?? [])
  // Anything else is a message userContent did not make: shown as it is.
  if (names.length !== texts.length - 1) return { prompt: texts.join(''), names: [] }
  return { prompt: texts.at(-1) ?? '', names }
}

/** What is piped in, as a text file named `stdin` (CLI-22). */
export async function attachStdin(input: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<Attachment> {
  if (input.isTTY) throw new Error('-a - attaches what is piped in, and nothing is: stdin is a terminal')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of input) {
    size += chunk.length
    if (size > MAX_FILE) throw new Error(`stdin is more than ${mb(MAX_FILE)}; navi attaches up to ${mb(MAX_FILE)}`)
    chunks.push(Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.includes('\u0000') || text.includes('\ufffd')) throw new Error('stdin is not text; save it to a file and attach that')
  return { kind: 'text', name: 'stdin', text: cut(text) }
}
