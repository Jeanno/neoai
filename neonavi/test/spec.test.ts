import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelSpec } from '../src/spec.ts'

test('unset defaults to remote, then the machine as the floor', () => {
  assert.deepEqual(parseModelSpec(undefined), [
    { where: 'remote' },
    { where: 'local', prefer: 'fast' },
  ])
})

test('a bare alias is a one-entry chain', () => {
  assert.deepEqual(parseModelSpec('remote'), [{ where: 'remote' }])
})

test('local aliases carry the size preference', () => {
  assert.deepEqual(parseModelSpec('fast'), [{ where: 'local', prefer: 'fast' }])
  assert.deepEqual(parseModelSpec('best'), [{ where: 'local' }])
})

// An id with a slash is an OpenRouter model; anything else names a local one.
test('a slashed id pins an exact remote model', () => {
  assert.deepEqual(parseModelSpec('stealth/ox-alpha'), [
    { where: 'remote', id: 'stealth/ox-alpha' },
  ])
})

test('an unslashed id pins an exact local model', () => {
  assert.deepEqual(parseModelSpec('qwen3.5:2b-q4_K_M'), [
    { where: 'local', id: 'qwen3.5:2b-q4_K_M' },
  ])
})

test('a list is the fallback chain, in order', () => {
  assert.deepEqual(parseModelSpec(['stealth/ox-alpha', 'local']), [
    { where: 'remote', id: 'stealth/ox-alpha' },
    { where: 'local', prefer: 'fast' },
  ])
})

// A fallback should answer quickly, so the bare alias means the quick one;
// 'best' is how you ask for the large local model instead.
test('local means the quick local model, and best the large one', () => {
  assert.deepEqual(parseModelSpec('local'), parseModelSpec('fast'))
  assert.notDeepEqual(parseModelSpec('local'), parseModelSpec('best'))
})

test('a comma separated string is the same chain, for the command line', () => {
  assert.deepEqual(parseModelSpec('remote,fast'), [
    { where: 'remote' },
    { where: 'local', prefer: 'fast' },
  ])
})

test('blank entries are ignored rather than becoming a broken link', () => {
  assert.deepEqual(parseModelSpec(['remote', '', '  ']), [{ where: 'remote' }])
})

test('an empty chain falls back to the default rather than resolving nothing', () => {
  assert.deepEqual(parseModelSpec([]), [{ where: 'remote' }, { where: 'local', prefer: 'fast' }])
})

// MOD-3, MOD-13: the keyless tier has a name, and is only there when named.
test('free names the keyless tier and is not in the default chain', () => {
  assert.deepEqual(parseModelSpec('free'), [{ where: 'free' }])
  assert.deepEqual(parseModelSpec('local, free'), [{ where: 'local', prefer: 'fast' }, { where: 'free' }])
  assert.ok(!parseModelSpec(undefined).some((e) => e.where === 'free'))
})

// MOD-4: a local id may contain a slash; the prefix says where it lives.
test('local: pins a local model even when its id has a slash', () => {
  assert.deepEqual(parseModelSpec('local:qwen/qwen3-4b'), [{ where: 'local', id: 'qwen/qwen3-4b' }])
})
