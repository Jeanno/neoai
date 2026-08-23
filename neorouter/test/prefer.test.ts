import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rank } from '../src/select.ts'
import type { Hardware, Server } from '../src/types.ts'

const hw: Hardware = {
  platform: 'darwin',
  arch: 'arm64',
  cores: 10,
  ramTotalGiB: 32,
  ramFreeGiB: 10,
  gpu: 'Apple M1 Pro',
  vramFreeGiB: 10,
  vramTotalGiB: 24,
}

/** Serves the two models actually installed on the dev machine. */
function fakeOllama(models: { name: string; size: number; params: string }[]) {
  return async (url: string) => {
    assert.ok(url.endsWith('/api/tags'))
    return {
      json: async () => ({
        models: models.map((m) => ({
          name: m.name,
          size: m.size,
          details: { parameter_size: m.params, quantization_level: 'Q4_K_M' },
        })),
      }),
    } as any
  }
}

const server: Server = {
  backend: 'ollama',
  baseURL: 'http://127.0.0.1:11434',
  native: 'ollama',
}

const MODELS = [
  { name: 'qwen3.8:27b-q4_K_M', size: 17_741_872_132, params: '27.0B' },
  { name: 'qwen3.5:2b-q4_K_M', size: 1_900_000_000, params: '2.0B' },
]

test('default ranking still puts the largest fitting model first', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeOllama(MODELS))

  const ranked = await rank([server], hw, 'capacity')

  assert.equal(ranked[0].id, 'qwen3.8:27b-q4_K_M')
})

test('prefer fast puts the smallest usable model first', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeOllama(MODELS))

  const ranked = await rank([server], hw, 'capacity', 'fast')

  assert.equal(ranked[0].id, 'qwen3.5:2b-q4_K_M')
})

test('prefer fast still rejects models that cannot answer a chat prompt', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    fakeOllama([
      { name: 'nomic-embed-text:latest', size: 274_000_000, params: '0.1B' },
      ...MODELS,
    ]),
  )

  const ranked = await rank([server], hw, 'capacity', 'fast')

  assert.equal(ranked[0].id, 'qwen3.5:2b-q4_K_M')
  assert.equal(ranked.at(-1)!.reject, 'not a chat model')
})
