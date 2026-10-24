import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changes, cutOff, describeAction, element, find, focused, pageLines, textLines, window } from '../src/page.ts'

const SNAPSHOT = `- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - link [ref=e3] [cursor=pointer]:
      - /url: /
      - img [ref=e4]
    - navigation "Main" [ref=e5]:
      - list [ref=e6]:
        - listitem [ref=e7]:
          - link "Docs" [ref=e8] [cursor=pointer]:
            - /url: /docs
        - listitem [ref=e9]:
          - text: "|"
  - main [ref=e10]:
    - heading "Orders" [level=1] [ref=e11]
    - table [ref=e12]:
      - rowgroup [ref=e13]:
        - row [ref=e14]:
          - cell "Order 7" [ref=e15]
          - cell [ref=e16]:
            - button "Cancel" [ref=e17] [cursor=pointer]
    - generic [ref=e18] [cursor=pointer]: Show more
    - textbox "Note" [active] [ref=e19]: hi
    - img "Chart" [ref=e20]`

// BRW-5
test('a page reads as its elements, refs only where something can be done', () => {
  assert.deepEqual(pageLines(SNAPSHOT), [
    'banner',
    '  link [ref=e3]',
    '  navigation "Main"',
    '    link "Docs" [ref=e8]',
    'main',
    '  heading "Orders" [level=1]',
    '  text: Order 7',
    '  button "Cancel" [ref=e17]',
    '  text [ref=e18]: Show more',
    '  textbox "Note" [ref=e19]: hi',
    '  img "Chart"',
  ])
})

// BRW-5
test('a long page is cut on a line boundary, saying how to go on', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `text: line ${i + 1} ${'x'.repeat(40)}`)
  const first = window(lines)
  assert.ok(first.length < 8200)
  const next = Number(/read again with offset (\d+)/.exec(first)![1])
  assert.equal(first.split('\n').at(-2), lines[next - 2])
  assert.ok(window(lines, next).startsWith(lines[next - 1]))
  assert.ok(!window(lines, 390).includes('more lines'))
  assert.match(window(lines, 401), /past the end/)
  assert.equal(window([]), '(the page has no text)')
})

// BRW-7
test('find returns the lines holding the text, numbered, with what they sit under', () => {
  const lines = pageLines(SNAPSHOT)
  assert.equal(
    find(lines, 'cancel'),
    '8: button "Cancel" [ref=e17] (under heading "Orders" [level=1])',
  )
  assert.equal(find(lines, 'docs'), '4: link "Docs" [ref=e8] (under navigation "Main")')
  assert.equal(find(lines, 'refund'), 'nothing on the page holds "refund"')
  const many = Array.from({ length: 60 }, (_, i) => `text: item ${i}`)
  assert.match(find(many, 'item'), /…\[10 more lines hold it\]$/)
})

// BRW-10
test('what an action changed: lines that appeared and how many went', () => {
  const before = ['main', '  button "Add" [ref=e2]', '  text: 0 items']
  assert.equal(changes(before, before), 'nothing on the page changed')
  assert.equal(
    changes(before, ['main', '  button "Add" [ref=e2]', '  text: 1 item', '  text: Added']),
    'appeared on the page:\n+ text: 1 item\n+ text: Added\n1 line went from the page',
  )
  assert.equal(changes(before, ['main']), 'nothing appeared\n2 lines went from the page')
  const flood = Array.from({ length: 45 }, (_, i) => `text: new ${i}`)
  assert.match(changes([], flood), /…\[5 more appeared; read the page to see them\]$/)
})

// BRW-11
test('an action is described in one line, by what its element says', () => {
  const lines = pageLines(SNAPSHOT)
  assert.equal(element(lines, 'e17'), 'button "Cancel"')
  assert.equal(element(lines, 'e18'), 'text Show more')
  assert.equal(element(lines, 'e99'), null)
  assert.equal(element(['link "Inbox [3]" [ref=e5]'], 'e5'), 'link "Inbox [3]"')
  assert.equal(describeAction({ kind: 'click', ref: 'e17' }, lines, { host: 'shop.test' }), 'click button "Cancel" on shop.test')
  assert.equal(
    describeAction({ kind: 'type', ref: 'e19', text: 'ship "fast"', submit: true }, lines, { host: 'shop.test' }),
    'type "ship \\"fast\\"" into textbox "Note" on shop.test, then press Enter',
  )
  assert.equal(describeAction({ kind: 'select', ref: 'e8', option: 'Large' }, lines, { host: '' }), 'choose "Large" in link "Docs"')
  assert.equal(describeAction({ kind: 'press', key: 'Enter' }, lines, { host: 'shop.test' }), 'press Enter on shop.test')
  assert.equal(describeAction({ kind: 'click', ref: 'e99' }, lines, { host: 'shop.test' }), null)
  assert.equal(
    describeAction({ kind: 'press', key: 'Enter' }, lines, { host: 'shop.test', focus: 'button "Pay"' }),
    'press Enter in button "Pay" on shop.test',
  )
  assert.equal(
    describeAction({ kind: 'click', ref: 'e8' }, lines, { host: 'shop.test', goes: 'evil.test' }),
    'click link "Docs" (goes to evil.test) on shop.test',
  )
  assert.equal(
    describeAction({ kind: 'click', ref: 'e17' }, lines, { host: 'evil.test', frame: 'bank.test' }),
    'click button "Cancel" on bank.test (in a frame on evil.test)',
  )
})

// BRW-11: words on the page that look like an element are not taken for one.
test('a ref is read only where the snapshot puts one, never from page text', () => {
  const lines = pageLines(`- text: link "Next page" [ref=e9]
- 'button "Delete: everything" [ref=e9]'
- link "Inbox [ref=e4]" [ref=e5]`)
  assert.deepEqual(lines, ['text: link "Next page" [ref=e9]', 'button "Delete: everything" [ref=e9]', 'link "Inbox [ref=e4]" [ref=e5]'])
  assert.equal(element(lines, 'e9'), 'button "Delete: everything"')
  assert.equal(element(lines, 'e4'), null)
  assert.equal(element(lines, 'e5'), 'link "Inbox [ref=e4]"')
})

// BRW-11: a key press lands on what has focus.
test('the focused element is the deepest one marked active', () => {
  assert.equal(focused(SNAPSHOT), 'textbox "Note"')
  assert.equal(focused('- generic [active] [ref=e1]:\n  - button "Go" [ref=e2]'), null)
})

// BRW-5: a page too complex to read as elements is read as its text, saying there are no refs.
test('a page read as text says it has no refs', () => {
  const lines = textLines('Squid\n\n  Cephalopods  \n|\nOrder Teuthida')
  assert.match(lines[0], /without refs/)
  assert.deepEqual(lines.slice(1), ['text: Squid', 'text: Cephalopods', 'text: Order Teuthida'])
})

// BRW-5: a table reads as its cells' contents, not rows and cells named after them.
test('rows and cells read as their contents', () => {
  const lines = pageLines(`- table [ref=e1]:
  - rowgroup [ref=e2]:
    - row "Octopus 3 hearts" [ref=e3]:
      - cell "Octopus" [ref=e4]:
        - link "Octopus" [ref=e5]
      - cell "3 hearts" [ref=e6]`)
  assert.deepEqual(lines, ['link "Octopus" [ref=e5]', 'text: 3 hearts'])
})

// BRW-5: a line a depth limit cut off is found by its ref, and only one at that depth with no words.
test('a part cut off by the depth limit is found', () => {
  assert.equal(cutOff('    - generic [ref=e9]', 2), 'e9')
  assert.equal(cutOff('    - generic [ref=e9]:', 2), 'e9')
  assert.equal(cutOff('    - generic [ref=e9]: some words', 2), null)
  assert.equal(cutOff('  - generic [ref=e9]', 2), null)
  assert.equal(cutOff('    - text: looks like [ref=e9]', 2), null)
})
