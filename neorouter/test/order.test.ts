import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rungOrder, rungsFor } from '../src/resolve.ts'

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

// With an explicit chain, the chain IS the fallback: each link resolves exactly
// one class of backend, or fails so the next link is tried. Otherwise a link
// quietly lands somewhere the caller never named — a typo'd remote id fell
// through to the anonymous tier rather than to the machine.
test('a keyed link tries only the keyed endpoint', () => {
  assert.deepEqual(rungsFor('keyed'), ['keyed'])
})

test('a local link tries only the machine', () => {
  assert.deepEqual(rungsFor('local'), ['reachable', 'launched'])
})

test('no scope keeps the full ordering for callers without a chain', () => {
  assert.deepEqual(rungsFor(undefined, true), rungOrder(true))
  assert.deepEqual(rungsFor(undefined, false), rungOrder(false))
})

test('no link reaches the anonymous tier unless it was asked for by name', () => {
  assert.ok(!rungsFor('keyed').includes('keyless'))
  assert.ok(!rungsFor('local').includes('keyless'))
})

// navi has no keyless tier (MOD-6): no scope a chain can name reaches it.
test('no scope reaches the keyless tier', () => {
  assert.deepEqual(rungsFor('keyed'), ['keyed'])
  assert.deepEqual(rungsFor('local'), ['reachable', 'launched'])
})
