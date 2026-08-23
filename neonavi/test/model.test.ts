import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelOptions } from '../src/args.ts'

test('goes remote first by default, with the small local model behind it', () => {
  assert.deepEqual(modelOptions(undefined), { prefer: 'fast', think: false, remote: true })
})

test('fast picks the smallest local model for the fallback', () => {
  assert.deepEqual(modelOptions('fast'), { prefer: 'fast', think: false, remote: true })
})

// No prefer: the local fallback is the largest model that fits.
test('best drops the size preference for the fallback', () => {
  assert.deepEqual(modelOptions('best'), { think: false, remote: true })
})

test('every mode tries remote first', () => {
  for (const f of [undefined, 'fast', 'best']) assert.equal(modelOptions(f)!.remote, true)
})

test('an unrecognised value is rejected rather than silently treated as fast', () => {
  assert.equal(modelOptions('medium'), null)
})
