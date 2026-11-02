import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARKDOWN_JS } from '../src/markdown.ts'

// The page's own code, run here as it runs there.
const { parseMarkdown, renderMarkdown } = new Function(`${MARKDOWN_JS}; return { parseMarkdown, renderMarkdown }`)()
const BT = '`'

// JOB-17
test('blocks: paragraphs, headings, lists, quotes, code, tables and rules', () => {
  const text = [
    '# Total',
    'The latte was **$5.25**,',
    'the loaf *7.50*.',
    '',
    '- Sourdough',
    '- Croissant',
    '  x2',
    '',
    '3. third',
    '4. fourth',
    '',
    '> quoted **too**',
    '',
    BT.repeat(3) + 'sh',
    'rm -rf build # not **bold**',
    BT.repeat(3),
    '---',
    '| Item | Price |',
    '|---|---:|',
    '| Latte | 5.25 |',
  ].join('\n')
  assert.deepEqual(parseMarkdown(text), [
    { t: 'h', level: 1, c: [{ t: 'text', v: 'Total' }] },
    { t: 'p', c: [{ t: 'text', v: 'The latte was ' }, { t: 'b', c: [{ t: 'text', v: '$5.25' }] }, { t: 'text', v: ',\nthe loaf ' }, { t: 'i', c: [{ t: 'text', v: '7.50' }] }, { t: 'text', v: '.' }] },
    { t: 'ul', start: 1, items: [[{ t: 'text', v: 'Sourdough' }], [{ t: 'text', v: 'Croissant\nx2' }]] },
    { t: 'ol', start: 3, items: [[{ t: 'text', v: 'third' }], [{ t: 'text', v: 'fourth' }]] },
    { t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'quoted ' }, { t: 'b', c: [{ t: 'text', v: 'too' }] }] }] },
    { t: 'pre', v: 'rm -rf build # not **bold**' },
    { t: 'hr' },
    { t: 'table', head: [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: 'Price' }]], rows: [[[{ t: 'text', v: 'Latte' }], [{ t: 'text', v: '5.25' }]]] },
  ])
})

test('inline code keeps what is in it as written, and snake_case is not italic', () => {
  assert.deepEqual(parseMarkdown(`run ${BT}npm **test**${BT} in my_dir_name`), [
    { t: 'p', c: [{ t: 'text', v: 'run ' }, { t: 'code', v: 'npm **test**' }, { t: 'text', v: ' in my_dir_name' }] },
  ])
  assert.deepEqual(parseMarkdown('2 * 3 * 4'), [{ t: 'p', c: [{ t: 'text', v: '2 * 3 * 4' }] }])
})

// JOB-18
test('only http and https become links; anything else stays as written', () => {
  assert.deepEqual(parseMarkdown('[docs](https://example.com/a) and [x](javascript:alert(1)) and [y](data:text/html,hi) and [z](/etc/passwd)'), [
    {
      t: 'p',
      c: [
        { t: 'a', href: 'https://example.com/a', c: [{ t: 'text', v: 'docs' }] },
        { t: 'text', v: ' and ' },
        { t: 'text', v: '[x](javascript:alert(1)' },
        { t: 'text', v: ') and ' },
        { t: 'text', v: '[y](data:text/html,hi)' },
        { t: 'text', v: ' and ' },
        { t: 'text', v: '[z](/etc/passwd)' },
      ],
    },
  ])
})

// JOB-17: what is rendered holds the text as text, whatever it says.
test('rendering passes text through as strings, never as markup', () => {
  const made: unknown[] = []
  const el = (tag: string, attrs: object = {}, ...kids: unknown[]) => (made.push(tag), { tag, attrs, kids: kids.flat(Infinity) })
  const out = renderMarkdown('<img src=x onerror=alert(1)> **<b>hi</b>** [a](https://e.com)', el)
  assert.deepEqual(out, [{ tag: 'p', attrs: {}, kids: [
    '<img src=x onerror=alert(1)> ',
    { tag: 'strong', attrs: {}, kids: ['<b>hi</b>'] },
    ' ',
    { tag: 'a', attrs: { href: 'https://e.com', target: '_blank', rel: 'noopener noreferrer' }, kids: ['a'] },
  ] }])
  assert.ok(!made.includes('img') && !made.includes('b'))
})
