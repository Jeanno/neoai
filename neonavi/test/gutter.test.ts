import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cells, columns, describeCall, makeGutter } from '../src/gutter.ts'

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

// CLI-44
test('markdown is drawn as it reads, across words, wraps and pieces', () => {
  const g = (answer: string, width = 40, size = 2) => {
    const gut = makeGutter(width)
    let out = ''
    for (let i = 0; i < answer.length; i += size) out += gut.text(answer.slice(i, i + size))
    return (out + gut.end()).replaceAll('\x1b[2m│\x1b[0m ', '| ').replaceAll('\x1b[2m│\x1b[0m', '|')
  }
  assert.equal(g('The **exact error** is `JSONDecodeError`.'), '| The \x1b[1mexact\x1b[22m'.replace('\x1b[22m', ' error\x1b[22m') + ' is \x1b[36mJSONDecodeError\x1b[39m.\n')
  // Styles carry over a wrap, and stop at the end of the line.
  assert.equal(g('**one two three four five six**', 20), '| \x1b[1mone two three four\n| \x1b[1mfive six\x1b[22m\n')
  assert.equal(g('**open\nnext'), '| \x1b[1mopen\x1b[0m\n| next\n')
  // A heading in bold, a bullet as one; snake_case and 2 * 3 stay as written.
  assert.equal(g('## Fix it\n- run `ls`\n'), '| \x1b[1mFix it\x1b[0m\n| • run \x1b[36mls\x1b[39m\n')
  assert.equal(g('use read_file, 2 * 3, *really*'), '| use read_file, 2 * 3, \x1b[3mreally\x1b[23m\n')
  // ** inside code is code.
  assert.equal(g('`a**b`'), '| \x1b[36ma**b\x1b[39m\n')
})

// CLI-44
test('a tool call reads in plain words', () => {
  const where = {
    cwd: '/home/u/proj',
    home: '/home/u',
    printedBy: (p: string) => (p === '/tmp/rec/1-3.txt' ? 'python3 app.py' : undefined),
  }
  const d = (name: string, input: unknown) => describeCall(name, input, where)
  assert.equal(d('read_file', { path: '/home/u/proj/app.py' }), 'read app.py')
  assert.equal(d('read_file', { path: '/home/u/notes.md', offset: 200, limit: 100 }), 'read ~/notes.md, lines 200–299')
  assert.equal(d('read_file', { path: '/tmp/rec/1-3.txt' }), 'read what `python3 app.py` printed')
  assert.equal(d('list_dir', { path: '/home/u/proj' }), 'list .')
  assert.equal(d('grep', { pattern: 'load_config', path: '/home/u/proj/src' }), 'search for "load_config" in src')
  assert.equal(d('run_shell', { command: 'ls -la\npwd' }), 'run ls -la ↵ pwd')
  assert.equal(d('web_search', { query: 'json decode error' }), 'search the web for "json decode error"')
  assert.equal(d('fetch_url', { url: 'https://example.com/a' }), 'fetch https://example.com/a')
  // A path outside both stays whole; a call with no words is undefined.
  assert.equal(d('edit_file', { path: '/etc/hosts', old_text: 'a', new_text: 'b' }), 'edit /etc/hosts')
  assert.equal(d('browser_click', { ref: 'e3' }), undefined)
  assert.equal(d('read_file', {}), undefined)
})

// CLI-46
test('a table is drawn in aligned columns, however it streams', () => {
  const answer = 'Sizes:\n\n| File | Size |\n|---|---:|\n| app.py | 12 KB |\n| 数据.csv | 1.2 MB |\n\nDone.'
  const want = '│ Sizes:\n│\n│ File        Size\n│ ────────  ──────\n│ app.py     12 KB\n│ 数据.csv  1.2 MB\n│\n│ Done.\n'
  for (const size of [1, 4, 100]) assert.equal(draw(answer, 40, size), want, `in pieces of ${size}`)
  // A table that ends the answer is drawn too.
  assert.equal(draw('| a | b |\n|---|---|\n| 1 | 2 |', 40), '│ a  b\n│ ─  ─\n│ 1  2\n')
})

test('a table too wide wraps its widest column, then goes row by row', () => {
  const answer = '| Name | Note |\n|---|---|\n| x | one two three four five six seven |\n'
  assert.equal(draw(answer, 24), '│ Name  Note\n│ ────  ────────────────\n│ x     one two three\n│       four five six\n│       seven\n')
  // Too narrow for columns: each cell on its own line, named by its header.
  const three = '| Alpha | Beta | Gamma |\n|---|---|---|\n| aaaaaaaaaaaa | bbbbbbbbbbbb | cccccccccccc |\n'
  assert.equal(draw(three, 22), '│ Alpha: aaaaaaaaaaaa\n│ Beta: bbbbbbbbbbbb\n│ Gamma: cccccccccccc\n')
})

test('cells split on | outside code, and wide characters take two columns', () => {
  assert.deepEqual(cells('| a | `x|y` | b \\| c |'), ['a', '`x|y`', 'b | c'])
  assert.equal(columns('数据'), 4)
  assert.equal(columns('\x1b[1mab\x1b[22m'), 2)
})

test('with colour, a table header is bold and its rule dim', () => {
  const g = makeGutter(40, true)
  const out = g.text('| **A** | B |\n|---|---|\n| `x` | y |\n') + g.end()
  assert.ok(out.includes('\x1b[1mA'), JSON.stringify(out))
  assert.ok(out.includes('\x1b[2m─'), JSON.stringify(out))
  assert.ok(out.includes('\x1b[36mx\x1b[39m'), JSON.stringify(out))
  assert.ok(!out.includes('|'), JSON.stringify(out))
})
