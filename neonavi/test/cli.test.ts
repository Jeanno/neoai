import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')
const TSX = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'tsx')

/** Runs navi as a user would, in a home of its own with no keys, stdin a pipe (never a terminal). */
async function navi(args: string[], { config = {}, input = '', home, quiet = true }: { config?: object; input?: string; home?: string; quiet?: boolean } = {}) {
  home ??= await mkdtemp(join(tmpdir(), 'navi-cli-'))
  await mkdir(join(home, '.neoai'), { recursive: true })
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify(config))
  // Only what running needs: no provider key may leak in from the real environment.
  const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: home, NEOROUTER_QUIET: quiet ? '1' : undefined }
  const child = spawn(TSX, [CLI, ...args], { env, cwd: home })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => (stdout += c))
  child.stderr.on('data', (c) => (stderr += c))
  child.stdin.end(input)
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? -1)))
  return { code, stdout, stderr }
}

// CLI-5
test('no prompt and no terminal prints usage and exits 1', async () => {
  const r = await navi([])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /^usage: navi /m)
  assert.equal(r.stdout, '')
})

// CLI-24
test('--help prints the usage and what each form does, and exits 0', async () => {
  for (const flag of ['-h', '--help', 'help']) {
    const r = await navi([flag])
    assert.equal(r.code, 0, flag)
    assert.match(r.stdout, /^usage: navi /)
    assert.match(r.stdout, /navi mcp +navi as a tool/)
  }
  const bad = await navi(['-p', 'hi', '--max-steps', 'lots'])
  assert.equal(bad.code, 1)
  assert.match(bad.stderr, /not a step count: lots\nusage: navi /)
})

// CLI-1
test('bare words are reported, not taken as a prompt', async () => {
  const r = await navi(['what', 'is', 'this'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /unexpected: what is this/)
})

// CLI-14, CLI-2, MOD-21: flags in any order; each link named with why; nothing on stdout.
test('with no model that answers, each link says why and navi exits 1', async () => {
  for (const args of [
    ['-p', 'hi', '--model', 'openai:gpt-5,anthropic:claude-sonnet-5-5'],
    ['--model', 'openai:gpt-5,anthropic:claude-sonnet-5-5', '-p', 'hi'],
  ]) {
    const r = await navi(args)
    assert.equal(r.code, 1, args.join(' '))
    assert.match(r.stderr, /primary \(gpt-5 on OpenAI\): no key for OpenAI/)
    assert.match(r.stderr, /fallback \(claude-sonnet-5-5 on Anthropic\): no key for Anthropic/)
    assert.match(r.stderr, /navi setup/)
    assert.equal(r.stdout, '')
  }
})

// CLI-22: a file that cannot be attached stops navi before any model is looked for.
test('a missing attachment is reported and navi exits 1', async () => {
  const r = await navi(['-p', 'hi', '-a', 'nope.png', '--model', 'openai:gpt-5'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /navi: nope\.png: no such file/)
  assert.doesNotMatch(r.stderr, /no key/)
})

// SET-3: setup without a terminal only reports.
test('setup without a terminal behaves as --check', async () => {
  const r = await navi(['setup'], { config: { model: 'openai:gpt-5' } })
  assert.equal(r.code, 1)
  assert.match(r.stdout + r.stderr, /can't find a model to answer with[^]*- The primary, gpt-5 on OpenAI: no key for OpenAI/)
})

// SES-14
test('sessions with nothing saved says so', async () => {
  const r = await navi(['sessions'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /No saved conversations yet/)
  assert.equal((await navi(['sessions', 'clear', '--all'])).stdout.trim(), 'There were no saved conversations.')
})

/**
 * An OpenAI-compatible server that lists one model and streams scripted
 * steps: a list_dir call first, then a plain answer.
 */
/** With `hang`, each answer starts with "Part one." and never finishes until the client leaves. */
async function fakeModel({ hang = false } = {}) {
  let calls = 0
  const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fake-1', context_length: 32000 }] }))
    req.resume()
    req.on('end', () => {
      const step = calls++
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (hang) return void res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Part one.' } }] })}\n\n`)
      res.end(
        step === 0
          ? sse([
              { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
            ])
          : sse([{ choices: [{ delta: { content: 'It holds .neoai.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]),
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  return {
    config: { model: 'box:fake-1', custom: { box: { baseURL: url } } },
    steps: () => calls,
    close: () => (server.closeAllConnections(), server.close()),
  }
}

// CLI-4, CLI-10, CLI-11, CLI-13, CLI-15, MOD-20
test('without a terminal navi answers once: the answer on stdout, everything else on stderr, history saved', async () => {
  const fake = await fakeModel()
  const home = await mkdtemp(join(tmpdir(), 'navi-cli-'))
  const r = await navi(['-p', 'what is here'], { config: fake.config, home, quiet: false })
  fake.close()
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.stdout, 'It holds .neoai.\n')
  // Announced once, as on this computer: 127.0.0.1 is this machine's own address.
  assert.match(r.stderr, /neorouter: box · fake-1 \(on this computer\)/)
  assert.match(r.stderr, /· list_dir\(\{"path":"\."\}\)/)
  const [file] = await readdir(join(home, '.neoai', 'sessions'))
  const saved = JSON.parse(await readFile(join(home, '.neoai', 'sessions', file), 'utf8'))
  assert.equal(saved.cwd.endsWith(home.split('/').pop()!), true)
  assert.deepEqual(saved.messages.map((m: any) => m.role), ['user', 'assistant', 'tool', 'assistant'])
  // SES-14: cleared by the path as typed, though it was saved under the real one (/var is /private/var).
  const cleared = await navi(['sessions', 'clear', home], { home })
  assert.match(cleared.stdout, /^Deleted the conversation saved for /)
})

/**
 * Runs navi on a terminal (a pty from script(1)), answering each `navi>`
 * prompt with the next of `lines`. Returns everything the terminal showed.
 */
async function naviOnTerminal(
  args: string[],
  lines: string[],
  config: object,
  /** Called with all shown so far on each output, to type keys that are not a line. */
  react?: (shown: string, type: (keys: string) => void) => void,
) {
  const home = await mkdtemp(join(tmpdir(), 'navi-cli-'))
  await mkdir(join(home, '.neoai'), { recursive: true })
  await writeFile(join(home, '.neoai', 'config.json'), JSON.stringify(config))
  const env = { PATH: process.env.PATH, HOME: home, NEOROUTER_QUIET: '1', TERM: 'xterm' }
  // script(1) needs real pipes, and node's stdio on macOS is a socket.
  const child = spawn('sh', ['-c', 'cat | script -q /dev/null "$@" | cat', 'sh', TSX, CLI, ...args], { env, cwd: home })
  let shown = ''
  let prompts = 0
  child.stdout.on('data', (c) => {
    shown += c
    react?.(shown, (keys) => child.stdin.write(keys))
    // One line per prompt shown, sent once it is.
    const seen = shown.split('navi>').length - 1
    while (prompts < seen) {
      const next = lines[prompts++]
      if (next !== undefined) child.stdin.write(`${next}\n`)
      // Ended after the last, or the cat feeding script(1) would wait forever.
      if (prompts >= lines.length) child.stdin.end()
    }
  })
  // A navi that never leaves fails the test rather than hanging the run.
  const limit = setTimeout(() => child.kill(), 30_000)
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? -1)))
  clearTimeout(limit)
  return { code, raw: shown, shown: shown.replace(/\x1b\[[0-9;]*m/g, ''), home }
}

// CLI-9: a step is one model response; the turn stops after --max-steps of them.
test('--max-steps bounds how many times the model is asked in one turn', async () => {
  const fake = await fakeModel()
  const r = await navi(['-p', 'what is here', '--max-steps', '1'], { config: fake.config })
  fake.close()
  assert.equal(fake.steps(), 1)
  assert.match(r.stderr, /list_dir/)
  assert.doesNotMatch(r.stdout, /It holds/)
})

// CLI-3, CLI-6, CLI-7, CLI-18, CLI-20: a session on a terminal: a turn, a blank line,
// the model shown and switched, then leaving.
test('on a terminal navi keeps asking until told to leave', { skip: process.platform !== 'darwin' }, async () => {
  const fake = await fakeModel()
  const r = await naviOnTerminal([], ['what is here', '', '/model', '/model box:nope', '/model', '/attach', 'QUIT'], fake.config)
  fake.close()
  assert.equal(r.code, 0, JSON.stringify(r.shown))
  assert.match(r.shown, /^navi · ask anything; \/help for commands; exit, \^C or \^D to leave/)
  assert.match(r.shown, /It holds \.neoai\./)
  assert.match(r.shown, /\/model\r?\r\n\r\nnavi answers with fake-1 on box, the primary \(on this computer\)\.\r\nsaved chain: fake-1 on box\r\n/)
  // A pin the endpoint no longer serves falls to what it does (MOD-19).
  assert.match(r.shown, /The pinned nope is gone/)
  assert.match(r.shown, /\/model\r?\r\n\r\n[^\n]*\r\nsaved chain: fake-1 on box\r\nthis session: nope on box\r\n/)
  // The blank line is ignored and QUIT leaves: one prompt per line sent.
  assert.match(r.shown, /usage: \/attach <file>/)
  // The prompt is gray with bright text, and what is typed after it bold until the line ends.
  assert.match(r.raw, /\x1b\[100;97mnavi>\x1b\[0m \x1b\[1m[^\n]*what is here\r\r?\n(\x1b\[0m)?/)
  assert.equal(r.shown.split('navi>').length - 1, 7)
})

// CLI-25: ^C during a turn stops it and keeps what was said; ^C at an empty prompt leaves.
test('^C stops a turn, keeps its words, and the prompt comes back', { skip: process.platform !== 'darwin' }, async () => {
  const fake = await fakeModel({ hang: true })
  let pressed = 0
  const r = await naviOnTerminal(['-p', 'tell me slowly'], [], fake.config, (shown, type) => {
    // Once mid-answer, then once at the prompt that follows.
    if (pressed === 0 && shown.includes('Part one.')) (pressed++, type('\x03'))
    if (pressed === 1 && shown.includes('stopped') && shown.split('navi>').length > 1) (pressed++, type('\x03'))
  })
  fake.close()
  assert.equal(r.code, 0, r.shown)
  assert.match(r.shown, /Part one\.[\s\S]*· stopped[\s\S]*navi>/)
  const [file] = await readdir(join(r.home, '.neoai', 'sessions'))
  const saved = JSON.parse(await readFile(join(r.home, '.neoai', 'sessions', file), 'utf8'))
  assert.deepEqual(saved.messages.at(-1), { role: 'assistant', content: 'Part one.' })
})

// CLI-7: ^C with something typed clears it rather than leaving.
test('^C clears a typed line; the next line is asked as typed', { skip: process.platform !== 'darwin' }, async () => {
  const fake = await fakeModel()
  let typed = false
  const r = await naviOnTerminal([], ['what is here', 'exit'], fake.config, (shown, type) => {
    // Typed and wiped before the real first line is sent.
    if (!typed && shown.includes('navi>')) (typed = true, type('never sent\x03'))
  })
  fake.close()
  assert.equal(r.code, 0, r.shown)
  const [file] = await readdir(join(r.home, '.neoai', 'sessions'))
  const saved = JSON.parse(await readFile(join(r.home, '.neoai', 'sessions', file), 'utf8'))
  assert.equal(saved.messages[0].content, 'what is here')
})

// CLI-26: a paste is one prompt, sent by the Enter after it.
test('a pasted block of lines is one prompt', { skip: process.platform !== 'darwin' }, async () => {
  const fake = await fakeModel()
  const r = await naviOnTerminal([], ['\x1b[200~first line\nsecond line\x1b[201~', 'exit'], fake.config)
  fake.close()
  assert.equal(r.code, 0, r.shown)
  assert.ok(r.raw.includes('\x1b[?2004h'), 'bracketed paste is asked for')
  const [file] = await readdir(join(r.home, '.neoai', 'sessions'))
  const saved = JSON.parse(await readFile(join(r.home, '.neoai', 'sessions', file), 'utf8'))
  const asked = saved.messages.filter((m: any) => m.role === 'user').map((m: any) => m.content)
  assert.deepEqual(asked, ['first line\nsecond line'])
})
