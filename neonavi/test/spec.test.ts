import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optionsFor, parseModelSpec } from '../src/spec.ts'

const LOCAL = { where: 'local', prefer: 'fast' }

// MOD-17: nothing leaves the machine until a provider is chosen.
test('unset or empty means the local model only', () => {
  assert.deepEqual(parseModelSpec(undefined), [LOCAL])
  assert.deepEqual(parseModelSpec([]), [LOCAL])
  assert.deepEqual(parseModelSpec(' , '), [LOCAL])
})

// MOD-3
test('local aliases carry the size preference', () => {
  assert.deepEqual(parseModelSpec('fast'), [LOCAL])
  assert.deepEqual(parseModelSpec('local'), [LOCAL])
  assert.deepEqual(parseModelSpec('best'), [{ where: 'local' }])
})

test('remote is OpenRouter, for configs written before providers', () => {
  assert.deepEqual(parseModelSpec('remote'), [{ where: 'remote', provider: 'openrouter' }])
})

// MOD-4
test('<provider>:<model> names a model at that provider', () => {
  assert.deepEqual(parseModelSpec('anthropic:claude-sonnet-5-5'), [
    { where: 'remote', provider: 'anthropic', id: 'claude-sonnet-5-5' },
  ])
  assert.deepEqual(parseModelSpec('openrouter:x-ai/grok-4.7'), [
    { where: 'remote', provider: 'openrouter', id: 'x-ai/grok-4.7' },
  ])
  assert.deepEqual(parseModelSpec('groq:openai/gpt-oss-120b'), [
    { where: 'remote', provider: 'groq', id: 'openai/gpt-oss-120b' },
  ])
})

test('<custom>:<model> names a model at a saved custom endpoint', () => {
  assert.deepEqual(parseModelSpec('box:qwen3-27b', ['box']), [{ where: 'remote', provider: 'box', id: 'qwen3-27b' }])
})

// An Ollama tag has the same shape as <name>:<model>; only known names are endpoints.
test('an unknown prefix is part of a local id', () => {
  assert.deepEqual(parseModelSpec('qwen3.5:2b-q4_K_M'), [{ where: 'local', id: 'qwen3.5:2b-q4_K_M' }])
  assert.deepEqual(parseModelSpec('box:qwen3-27b'), [{ where: 'local', id: 'box:qwen3-27b' }])
})

test('a bare slashed id is an OpenRouter model', () => {
  assert.deepEqual(parseModelSpec('stealth/ox-alpha'), [{ where: 'remote', provider: 'openrouter', id: 'stealth/ox-alpha' }])
  assert.deepEqual(parseModelSpec('stealth/ox-alpha'), parseModelSpec('openrouter:stealth/ox-alpha'))
})

test('local: pins a local model even when its id has a slash', () => {
  assert.deepEqual(parseModelSpec('local:qwen/qwen3-4b'), [{ where: 'local', id: 'qwen/qwen3-4b' }])
})

// MOD-1, MOD-5
test('a list is the fallback chain, in order', () => {
  assert.deepEqual(parseModelSpec(['openai:gpt-6.1-sol', 'local']), [
    { where: 'remote', provider: 'openai', id: 'gpt-6.1-sol' },
    LOCAL,
  ])
})

test('a comma separated string is the same chain, for the command line', () => {
  assert.deepEqual(parseModelSpec('remote, fast'), parseModelSpec(['remote', 'fast']))
})

test('blank entries are ignored rather than becoming a broken link', () => {
  assert.deepEqual(parseModelSpec(['best', '', '  ']), [{ where: 'local' }])
})

// MOD-6, MOD-13: there is no keyless tier; `free` is no alias any more.
test('free is not the keyless tier', () => {
  assert.deepEqual(parseModelSpec('free'), [{ where: 'local', id: 'free' }])
})

// MOD-6: each link is scoped to what it names.
test('a local link is scoped to the machine, a remote one to its provider', () => {
  assert.deepEqual(optionsFor(LOCAL as any), { prefer: 'fast', think: false, model: undefined, scope: 'local' })
  assert.deepEqual(optionsFor({ where: 'remote', provider: 'groq', id: 'm' }), {
    think: false,
    model: 'm',
    provider: 'groq',
  })
})
