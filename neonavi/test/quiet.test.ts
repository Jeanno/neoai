import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromWall, type Offset } from '../src/clock.ts'
import { digest, isQuiet, makeQuietNotify, parseQuiet } from '../src/quiet.ts'

/** UTC-7, as Vancouver now is all year. */
const zone: Offset = () => -420
const at = (h: number, m = 0) => fromWall(2026, 10, 2, h, m, zone)

test('PSH-11: quiet hours are two times joined by -, and may cross midnight', () => {
  assert.deepEqual(parseQuiet('22:00-07:00'), { from: 22 * 60, to: 7 * 60 })
  assert.deepEqual(parseQuiet(' 9:30 - 12:00 '), { from: 570, to: 720 })
  for (const bad of ['22:00', '25:00-07:00', '22:00-07:60', '08:00-08:00', 22, undefined, 'tonight']) assert.equal(parseQuiet(bad), undefined, String(bad))
  const night = parseQuiet('22:00-07:00')!
  assert.ok(isQuiet(night, at(23, 30), zone))
  assert.ok(isQuiet(night, at(3), zone))
  assert.ok(!isQuiet(night, at(7), zone))
  assert.ok(!isQuiet(night, at(21, 59), zone))
  const day = parseQuiet('12:00-13:00')!
  assert.ok(isQuiet(day, at(12, 30), zone))
  assert.ok(!isQuiet(day, at(13), zone))
})

test('PSH-12: what was held reads as one notification, counted, the latest named first', () => {
  const d = digest([
    { title: 'navi done', text: 'Write a haiku', job: 'a' },
    { title: 'navi failed', text: 'Check the backups', job: 'b' },
    { title: 'navi is waiting for you', text: 'Tidy notes: $ rm old.txt', job: 'c' },
    { title: 'navi done', text: 'Tidy notes', job: 'c' },
    { title: 'navi paused a schedule', text: 'Check the backups: its last 3 runs failed.', job: 'b' },
    { title: 'navi done', text: 'Read the news', job: 'd' },
  ])
  assert.equal(d.title, 'navi, during quiet hours')
  assert.equal(d.job, 'd')
  assert.deepEqual(d.text.split('\n'), [
    '3 done, 1 failed, 1 waiting for you, 1 more',
    'done: Read the news',
    'paused a schedule: Check the backups: its last 3 runs failed.',
    'done: Tidy notes',
    'and 1 more',
  ])
})

test('PSH-11, PSH-12: notifications in quiet hours are held, then sent as one once they end; a config change is followed', async () => {
  let now = at(23)
  let config: string | undefined = '22:00-07:00'
  const sent: { title: string; text: string; job: string; urgent?: boolean; key?: string }[] = []
  const logged: string[] = []
  const q = makeQuietNotify((title, text, job, urgent, key) => sent.push({ title, text, job, urgent, key }), async () => parseQuiet(config), (l) => logged.push(l), () => now, zone)
  const settle = () => new Promise((r) => setTimeout(r, 5))
  q.notify('navi done', 'Write a haiku', 'a')
  q.notify('navi is waiting for you', 'Tidy: $ rm x', 'b', true, 'k1')
  await settle()
  assert.equal(sent.length, 0)
  assert.equal(q.held(), 2)
  assert.match(logged[0], /held a notification for job a/)
  await q.flush()
  assert.equal(sent.length, 0, 'still quiet')
  now = at(7, 1)
  await q.flush()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].text.split('\n')[0], '1 done, 1 waiting for you')
  // The buttons of a held approval are not in it.
  assert.equal(sent[0].key, undefined)
  await q.flush()
  assert.equal(sent.length, 1, 'sent once')
  // Out of quiet hours, at once and as it was.
  q.notify('navi is waiting for you', 'Tidy: $ rm y', 'c', true, 'k2')
  await settle()
  assert.deepEqual(sent[1], { title: 'navi is waiting for you', text: 'Tidy: $ rm y', job: 'c', urgent: true, key: 'k2' })
  // No quiet hours set, or a bad value: nothing held, at night too.
  now = at(2)
  config = undefined
  q.notify('navi done', 'x', 'd')
  config = 'late'
  q.notify('navi done', 'y', 'e')
  await settle()
  assert.equal(sent.length, 4)
})

// PSH-14: a waiting change's lines are for its own notification, not the summary.
test('the summary names a waiting change by its first line only', () => {
  const d = digest([{ title: 'navi is waiting for you', text: 'fix it: edit a.ts (+1 -1)\n- old\n+ new', job: 'j1' }])
  assert.equal(d.text, '1 waiting for you\nis waiting for you: fix it: edit a.ts (+1 -1)')
})

// PSH-14, PSH-15
test('a glance at a change is its changed lines, a few, cut short; at an action, its page', async () => {
  const { glance, glancePage, GLANCE_LINES } = await import('../src/diff.ts')
  const many = ['@@ line 3 @@', '  ctx', ...Array.from({ length: 9 }, (_, i) => `+ line ${i}`), '  ctx']
  const g = glance({ diff: many.join('\n') }).split('\n')
  assert.equal(g.length, GLANCE_LINES + 1)
  assert.deepEqual(g.slice(0, 2), ['+ line 0', '+ line 1'])
  assert.equal(g.at(-1), '… 3 more lines')
  assert.equal(glance({ diff: `- ${'x'.repeat(100)}` }), `- ${'x'.repeat(57)}…`)
  assert.equal(glance({ diff: '(no change)' }), '')
  assert.equal(glancePage('https://example.com/'), 'on example.com')
  assert.equal(glancePage('https://example.com/a/b?secret=1#x'), 'on example.com/a/b')
  assert.equal(glancePage('not a url'), '')
})
