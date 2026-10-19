import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForAnswer, type Approval } from '../src/lib/approval.ts'

const shown = () => {
  const seen: (Approval | null)[] = []
  return { seen, show: (a: Approval | null) => seen.push(a) }
}

test('RAY-3: the command is shown, and Run Command runs it', async () => {
  const { seen, show } = shown()
  const answer = waitForAnswer('rm x', new AbortController().signal, show)
  assert.equal(seen[0]?.command, 'rm x')
  seen[0]!.answer(true)
  assert.equal(await answer, true)
  assert.equal(seen.at(-1), null)
})

test("RAY-3: Don't Run declines, and only the first answer counts", async () => {
  const { seen, show } = shown()
  const answer = waitForAnswer('rm x', new AbortController().signal, show)
  seen[0]!.answer(false)
  seen[0]!.answer(true)
  assert.equal(await answer, false)
})

test('RAY-3: stopping or leaving the view declines', async () => {
  const { seen, show } = shown()
  const stop = new AbortController()
  const answer = waitForAnswer('rm x', stop.signal, show)
  stop.abort()
  assert.equal(await answer, false)
  assert.equal(seen.at(-1), null)
})

test('RAY-3: an already stopped turn declines without asking', async () => {
  const { seen, show } = shown()
  assert.equal(await waitForAnswer('rm x', AbortSignal.abort(), show), false)
  assert.equal(seen.length, 0)
})
