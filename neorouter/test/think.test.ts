import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reasoningEffort } from '../src/provider.ts'

const ollama = { backend: 'ollama', baseURL: 'http://127.0.0.1:11434', native: 'ollama' } as const
const openaiish = { backend: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1' } as const

// Measured on ollama 0.32.15 / qwen3.5:2b: reasoning_effort 'none' takes
// reasoning from 6234 chars to 0. `think: false` is ignored on this endpoint.
test('asks ollama for no reasoning when thinking is off', () => {
  assert.equal(reasoningEffort(ollama, false), 'none')
})

test('sends nothing when thinking is left alone', () => {
  assert.equal(reasoningEffort(ollama, undefined), undefined)
})

test('sends nothing when thinking is explicitly on', () => {
  assert.equal(reasoningEffort(ollama, true), undefined)
})

// Other OpenAI-shaped servers reject unknown fields inconsistently; only
// measured backends get the flag.
test('does not send the flag to unmeasured backends', () => {
  assert.equal(reasoningEffort(openaiish, false), undefined)
})

// The backend name is no evidence of what a server honours; being custom is (MOD-11).
test('a server is asked by being custom, not by its name', () => {
  assert.equal(reasoningEffort({ backend: 'darkbloom', baseURL: 'http://127.0.0.1:9000/v1', auth: 'k' }, false), undefined)
  assert.equal(reasoningEffort({ backend: 'box', baseURL: 'http://127.0.0.1:9000/v1', custom: true }, false), 'none')
  assert.equal(reasoningEffort({ backend: 'box', baseURL: 'http://127.0.0.1:9000/v1', custom: true }, undefined), undefined)
})
