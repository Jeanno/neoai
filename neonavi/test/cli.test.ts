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
async function fakeModel() {
  let calls = 0
  const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fake-1', context_length: 32000 }] }))
    req.resume()
    req.on('end', () => {
      const step = calls++
      res.writeHead(200, { 'content-type': 'text/event-stream' })
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
  return { config: { model: 'box:fake-1', custom: { box: { baseURL: url } } }, close: () => server.close() }
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
})
