import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { announce } from '../src/resolve.ts'

// MOD-28
test('with NEOROUTER_SEEN the backend is announced only when it changes', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'neorouter-seen-')), 'seen')
  const said = mock.method(console, 'error', () => {})
  const local = { backend: 'Ollama', modelId: 'qwen3', rung: 'reachable', local: true } as const
  process.env.NEOROUTER_SEEN = file
  try {
    announce(local)
    announce(local)
    announce({ ...local, backend: 'OpenAI', modelId: 'gpt-x', rung: 'hosted', local: false })
    announce(local)
    assert.deepEqual(
      said.mock.calls.map((c) => c.arguments[0]),
      ['neorouter: Ollama · qwen3 (reachable)', 'neorouter: OpenAI · gpt-x (hosted)', 'neorouter: Ollama · qwen3 (reachable)'],
    )
    assert.equal(await readFile(file, 'utf8'), 'neorouter: Ollama · qwen3 (reachable)')
    // A file that cannot be written announces every time, as without one.
    process.env.NEOROUTER_SEEN = join(file, 'not-a-dir', 'seen')
    announce(local)
    announce(local)
    assert.equal(said.mock.calls.length, 5)
  } finally {
    delete process.env.NEOROUTER_SEEN
    said.mock.restore()
  }
})
