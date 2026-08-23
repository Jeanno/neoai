import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rungOrder } from '../src/resolve.ts'

test('local first by default: nothing leaves the machine unasked', () => {
  assert.deepEqual(rungOrder(false), ['reachable', 'launched', 'keyed', 'keyless'])
})

test('remote first tries the keyed endpoint before the local rungs', () => {
  assert.deepEqual(rungOrder(true), ['keyed', 'reachable', 'launched', 'keyless'])
})

test('remote-first moves only the keyed endpoint above local', () => {
  assert.deepEqual(rungOrder(true).slice(1, 3), ['reachable', 'launched'])
})

// The bug this replaces: with no key, remote-first fell through to the keyless
// tier instead of the machine — slower, flakier, and still off-machine, which
// is worse than the laptop on every axis including privacy.
test('the keyless tier is last in both orders, below local', () => {
  for (const remote of [true, false]) {
    const order = rungOrder(remote)
    assert.equal(order.at(-1), 'keyless')
    assert.ok(order.indexOf('reachable') < order.indexOf('keyless'))
    assert.ok(order.indexOf('launched') < order.indexOf('keyless'))
  }
})
