import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { makeApprover } from '../src/approve.ts'
import { systemPrompt } from '../src/args.ts'

function io(typed: string) {
  const input = Readable.from([typed])
  const output = new Writable({ write: (_c, _e, cb) => cb() })
  return { input, output }
}

test('y approves the command', async () => {
  const { approve, close } = makeApprover(io('y\n'))
  assert.equal(await approve('echo hi'), true)
  close()
})

test('n declines the command', async () => {
  const { approve, close } = makeApprover(io('n\n'))
  assert.equal(await approve('rm -rf /'), false)
  close()
})

test('anything else declines', async () => {
  const { approve, close } = makeApprover(io('maybe\n'))
  assert.equal(await approve('rm -rf /'), false)
  close()
})

// The safety-critical case: piped or redirected stdin, so nobody is there to
// answer. Silence must never read as consent.
test('declines when stdin is closed with no answer', async () => {
  const { approve, close } = makeApprover(io(''))
  assert.equal(await approve('rm -rf /'), false)
  close()
})

test('tells the model where it is running', () => {
  assert.match(systemPrompt('/Users/jeanno/Projects/neoai'), /\/Users\/jeanno\/Projects\/neoai/)
})

test('tells the model paths are relative to that directory', () => {
  assert.match(systemPrompt('/tmp/x'), /relative/i)
})

// The CLI builds the approver at startup but does not ask until the model's
// first tool call, seconds later. A readline interface created eagerly drains
// piped stdin in the meantime, so the answer is gone by the time we ask.
test('still reads the answer when asked well after construction', async () => {
  const { approve, close } = makeApprover(io('y\n'))
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(await approve('echo hi'), true)
  close()
})
