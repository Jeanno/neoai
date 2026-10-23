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

// RAY-3, TL-43: Always is offered for a plain command, never for a chain or a file change.
test('always is offered only where the command could be allowed', async () => {
  const seen: (Approval | null)[] = []
  const show = (a: Approval | null) => seen.push(a)
  const plain = waitForAnswer('npm test', new AbortController().signal, show)
  assert.equal(seen[0]!.always, true)
  seen[0]!.answer('always')
  assert.equal(await plain, 'always')
  waitForAnswer('npm test && rm x', new AbortController().signal, show)
  assert.equal(seen.at(-1)!.always, false)
  waitForAnswer('edit a.ts (+1 -1)', new AbortController().signal, show, {
    path: 'a.ts',
    created: false,
    diff: '',
    added: 1,
    removed: 1,
  })
  assert.equal(seen.at(-1)!.always, false)
})

test('RAY-3, BRW-11: a browser action shows its page and is never offered Always', async () => {
  const { seen, show } = shown()
  const answer = waitForAnswer('click button "Buy" on shop.test', new AbortController().signal, show, undefined, {
    url: 'https://shop.test/',
  })
  assert.deepEqual(seen[0]?.action, { url: 'https://shop.test/' })
  assert.equal(seen[0]?.always, false)
  seen[0]!.answer(true)
  assert.equal(await answer, true)
})
