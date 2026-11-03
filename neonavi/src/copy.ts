import { spawn } from 'node:child_process'
import { unshell } from './args.ts'

/** The fenced code blocks of an answer, without their fences (CLI-31). */
export function codeBlocks(text: string): string[] {
  return fenced(text).map((b) => b.body)
}

/** Each fenced block with the language its fence names, lowercased ('' for none). */
function fenced(text: string): { lang: string; body: string }[] {
  const out: { lang: string; body: string }[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[i])
    if (!open) continue
    const body: string[] = []
    // Closed by a fence of the same kind at least as long; an unclosed one runs to the end.
    while (++i < lines.length && !new RegExp(`^\\s*${open[1][0] === '`' ? '`' : '~'}{${open[1].length},}\\s*$`).test(lines[i])) body.push(lines[i])
    out.push({ lang: open[2].toLowerCase(), body: body.join('\n') })
  }
  return out
}

/** CLI-41: the one-line shell command an answer ends with, for the user's prompt; or none. */
export function suggestedCommand(text: string): string | undefined {
  const last = fenced(text).at(-1)
  if (!last || !['', 'sh', 'bash', 'zsh', 'shell', 'console', 'shell-session'].includes(last.lang)) return
  const lines = last.body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length !== 1) return
  const command = lines[0].replace(/^\$\s+/, '')
  return command && !command.startsWith('#') ? command : undefined
}

/** What `/copy [code [n]]` takes from the last answer, with what to say; or why nothing (CLI-31). */
export function pickCopy(answer: string | undefined, args: string): { text: string; said: string } | { problem: string } {
  const lines = (t: string) => {
    const n = t.replace(/\n+$/, '').split('\n').length
    return `${n} line${n === 1 ? '' : 's'}`
  }
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length && (words[0] !== 'code' || words.length > 2 || (words[1] !== undefined && !/^[1-9]\d*$/.test(words[1]))))
    return { problem: 'usage: /copy, /copy code or /copy code <n>' }
  if (!answer?.trim()) return { problem: 'There is no answer to copy yet.' }
  if (!words.length) return { text: answer, said: `copied the answer (${lines(answer)})` }
  const blocks = codeBlocks(answer)
  if (!blocks.length) return { problem: 'The last answer has no code block; /copy copies all of it.' }
  const n = words[1] === undefined ? blocks.length : Number(words[1])
  if (n > blocks.length) return { problem: `The last answer has ${blocks.length} code block${blocks.length === 1 ? '' : 's'}.` }
  const text = blocks[n - 1]
  return { text, said: `copied ${blocks.length === 1 ? 'the code block' : `code block ${n} of ${blocks.length}`} (${lines(text)})` }
}

/** CLI-36: what `/save [code [n]] <file>` writes, the path as typed, and what to say; or why nothing. */
export function pickSave(answer: string | undefined, args: string): { text: string; path: string; said: string } | { problem: string } {
  const code = /^code(?:\s+([1-9]\d*))?\s+(\S[\s\S]*)$/.exec(args.trim())
  const path = unshell(code ? code[2] : args)
  if (!path || (!code && /^code(\s+\d+)?$/.test(args.trim()))) return { problem: 'usage: /save <file>, /save code <file> or /save code <n> <file>' }
  const got = pickCopy(answer, code ? `code ${code[1] ?? ''}` : '')
  if ('problem' in got) return { problem: got.problem.replace('There is no answer to copy yet.', 'There is no answer to save yet.').replace('/copy copies', '/save <file> saves') }
  const text = got.text.endsWith('\n') ? got.text.replace(/\n+$/, '\n') : `${got.text}\n`
  return { text, path, said: got.said.replace(/^copied/, 'saved') }
}

/** The clipboard commands to try, in order, on this platform (CLI-32). */
export function clipboardCommands(platform: string = process.platform): string[][] {
  if (platform === 'darwin') return [['pbcopy']]
  if (platform === 'win32') return [['clip']]
  return [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
}

/** Feeds text to a command; false when it is not there or fails. */
function feed(command: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
    child.stdin.on('error', () => {})
    child.stdin.end(text)
  })
}

/**
 * Puts text on the clipboard (CLI-32): over SSH the terminal's, through
 * OSC 52, as the system's there is another computer's; otherwise the first
 * clipboard command that works. A problem, said, when none does.
 */
export async function toClipboard(
  text: string,
  o: { env?: NodeJS.ProcessEnv; platform?: string; write?: (s: string) => void; run?: (command: string[], text: string) => Promise<boolean> } = {},
): Promise<string | undefined> {
  const env = o.env ?? process.env
  if (env.SSH_CONNECTION || env.SSH_TTY) {
    ;(o.write ?? ((s) => process.stdout.write(s)))(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
    return
  }
  for (const command of clipboardCommands(o.platform)) if (await (o.run ?? feed)(command, text)) return
  return 'No clipboard was found (pbcopy, wl-copy, xclip, xsel or clip).'
}

/** The last answer in a conversation: its last assistant text, for `/copy` after `--resume` (CLI-31). */
export function lastAnswerIn(history: readonly { role: string; content: unknown }[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== 'assistant') continue
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content) ? m.content.filter((p) => p?.type === 'text').map((p) => p.text).join('') : ''
    if (text.trim()) return text
  }
}
