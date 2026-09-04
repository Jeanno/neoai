import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { makeSpinner } from '../src/spinner.ts'

function sink(isTTY: boolean) {
  const chunks: string[] = []
  const out = new Writable({
    write: (c, _e, cb) => {
      chunks.push(String(c))
      cb()
    },
  }) as Writable & { isTTY?: boolean }
  out.isTTY = isTTY
  return { out, chunks }
}

// CLI-16
test('draws frames on a terminal and erases the line on stop', async () => {
  const { out, chunks } = sink(true)
  const s = makeSpinner(out)
  s.start()
  await new Promise((r) => setTimeout(r, 200))
  s.stop()
  assert.ok(chunks.length >= 2, 'animated')
  assert.ok(chunks.slice(0, -1).every((c) => c.startsWith('\r')), 'redraws in place')
  assert.equal(chunks.at(-1), '\r\x1b[K')
})

// CLI-17
test('writes nothing when stderr is not a terminal', async () => {
  const { out, chunks } = sink(false)
  const s = makeSpinner(out)
  s.start()
  await new Promise((r) => setTimeout(r, 100))
  s.stop()
  assert.deepEqual(chunks, [])
})

test('stop without start, and double stop, write nothing', () => {
  const { out, chunks } = sink(true)
  const s = makeSpinner(out)
  s.stop()
  s.start()
  s.stop()
  s.stop()
  assert.equal(chunks.filter((c) => c === '\r\x1b[K').length, 1)
})
