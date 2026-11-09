import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGutter } from '../src/gutter.ts'

/** The answer drawn as it streams, in pieces of `size` characters. */
function draw(answer: string, width: number, size = 3) {
  const g = makeGutter(width, false)
  let out = ''
  for (let i = 0; i < answer.length; i += size) out += g.text(answer.slice(i, i + size))
  return out + g.end()
}

// CLI-43
test('an answer is drawn in a gutter, words wrapped inside it', () => {
  assert.equal(draw('The error is on line 2 of app.py, where the key is not quoted.', 24), '│ The error is on line 2\n│ of app.py, where the\n│ key is not quoted.\n')
  assert.equal(draw('one\n\ntwo\n', 40), '│ one\n│\n│ two\n')
  // Blank lines before a note or the end are not drawn.
  assert.equal(draw('Let me look.\n\n', 40), '│ Let me look.\n')
  // A code block left open is closed.
  assert.equal(draw('Run:\n```sh\nls\n', 40), '│ Run:\n\n    ls\n\n')
  // An indented list keeps its indent.
  assert.equal(draw('Fixes:\n  - quote the key\n', 40), '│ Fixes:\n│   - quote the key\n')
})

// CLI-43
test('a code block is drawn without the gutter, so it copies clean', () => {
  const answer = 'Quote the key:\n```python\njson.loads(\'{"bad": 1}\')\nprint("a  b")\n```\nThen run it again.'
  const want = '│ Quote the key:\n\n    json.loads(\'{"bad": 1}\')\n    print("a  b")\n\n│ Then run it again.\n'
  for (const size of [1, 2, 5, 100]) assert.equal(draw(answer, 40, size), want, `in pieces of ${size}`)
  // A long code line is not wrapped.
  assert.equal(draw('```\n' + 'x'.repeat(50) + '\n```', 30), `\n    ${'x'.repeat(50)}\n\n`)
})

// CLI-43
test("navi's notes are in the gutter too, dim on a terminal", () => {
  assert.equal(makeGutter(40, false).note('· read app.py'), '│ · read app.py')
  assert.equal(makeGutter(40).note('x'), '\x1b[2m│\x1b[0m \x1b[2mx\x1b[0m')
})
