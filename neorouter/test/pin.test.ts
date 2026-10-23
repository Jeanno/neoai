import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from '../src/select.ts'
import type { Candidate } from '../src/types.ts'

const cand = (id: string, score: number, reject?: string) =>
  ({ id, score, reject, server: {}, bytes: 0, params: null, quantBits: null, instruct: true }) as Candidate

test('without a pin, the top-ranked candidate wins', () => {
  assert.equal(pick([cand('big', 9), cand('small', 1)])?.id, 'big')
})

test('a pinned id is taken even when it is not the best ranked', () => {
  assert.equal(pick([cand('big', 9), cand('small', 1)], 'small')?.id, 'small')
})

// MOD-8: pinning a model the machine does not have must fail this link of the chain,
// so the next one is tried — not silently answer with something else.
test('a pin that matches nothing resolves nothing', () => {
  assert.equal(pick([cand('big', 9)], 'absent'), null)
})

test('a pinned model that was rejected is still refused', () => {
  assert.equal(pick([cand('huge', 0, 'needs more memory than there is')], 'huge'), null)
})

test('nothing usable resolves nothing', () => {
  assert.equal(pick([cand('huge', 0, 'too big')]), null)
})
