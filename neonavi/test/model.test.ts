import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelOptions } from '../src/args.ts'

test('defaults to the fast model when no flag is given', () => {
  assert.deepEqual(modelOptions(undefined), { prefer: 'fast', think: false })
})

test('fast asks neorouter for the smallest usable model', () => {
  assert.deepEqual(modelOptions('fast'), { prefer: 'fast', think: false })
})

// No prefer: neorouter falls back to its default, the largest model that fits.
test('best drops the size preference and takes the capable model', () => {
  assert.deepEqual(modelOptions('best'), { think: false })
})

test('an unrecognised value is rejected rather than silently treated as fast', () => {
  assert.equal(modelOptions('medium'), null)
})
