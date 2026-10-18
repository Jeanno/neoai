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

// Measured on Darkbloom 0.9.22 / Qwen3.8-27B: 3.4s → 0.6s, no </think> in the output.
const darkbloom = { backend: 'darkbloom', baseURL: 'http://100.64.0.1:8000/v1', auth: 'k' } as const

test('asks darkbloom for no reasoning when thinking is off', () => {
  assert.equal(reasoningEffort(darkbloom, false), 'none')
})

test('leaves darkbloom alone when thinking is not turned off', () => {
  assert.equal(reasoningEffort(darkbloom, undefined), undefined)
})
