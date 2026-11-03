import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { notifyLevels, push, pushConfig, withLevels, type PushConfig } from '../src/push.ts'

/** A fetch that records what it was sent and answers with `status`. */
function recorder(status = 200) {
  const sent: { url: string; body: any }[] = []
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    return new Response('{}', { status })
  }) as unknown as typeof fetch
  return { sent, f }
}

test('PSH-1: a topic URL, or one with detail, is the push config; anything else is not', () => {
  assert.deepEqual(pushConfig({ push: 'https://ntfy.sh/navi-abc' }), { server: 'https://ntfy.sh', topic: 'navi-abc', detail: false, waiting: false, off: false })
  assert.deepEqual(pushConfig({ push: { url: 'http://box.tail:2586/ntfy/mine', detail: true } }), {
    server: 'http://box.tail:2586/ntfy',
    topic: 'mine',
    detail: true,
    waiting: false,
    off: false,
  })
  // PSH-18
  assert.equal(pushConfig({ push: { url: 'https://ntfy.sh/t', notify: 'waiting' } })?.waiting, true)
  assert.equal(pushConfig({ push: { url: 'https://ntfy.sh/t', notify: 'all' } })?.waiting, false)
  assert.equal(pushConfig({}), undefined)
  assert.equal(pushConfig({ push: 'https://ntfy.sh/' }), undefined)
  assert.equal(pushConfig({ push: 'ftp://ntfy.sh/x' }), undefined)
  assert.equal(pushConfig({ push: 'not a url' }), undefined)
  assert.equal(pushConfig({ push: 42 }), undefined)
})

const plain: PushConfig = { server: 'https://ntfy.sh', topic: 't', detail: false, waiting: false, off: false }

test('PSH-2: a push says what happened and the job id, and the prompt only with detail', async () => {
  const { sent, f } = recorder()
  await push(plain, { title: 'navi is waiting for you', job: 'ab12cd34', detail: 'Delete the build: rm -rf build' }, f)
  assert.equal(sent[0].url, 'https://ntfy.sh')
  assert.equal(sent[0].body.topic, 't')
  assert.equal(sent[0].body.title, 'navi is waiting for you')
  assert.equal(sent[0].body.message, 'Job ab12cd34')
  assert.doesNotMatch(JSON.stringify(sent[0].body), /rm -rf/)
  await push({ ...plain, detail: true }, { title: 'navi is done', job: 'ab12cd34', detail: 'Delete the build…' }, f)
  assert.equal(sent[1].body.message, 'Job ab12cd34: Delete the build…')
})

test('PSH-3: a push opens the job without the token, and one waiting on you is urgent', async () => {
  const { sent, f } = recorder()
  await push(plain, { title: 'navi is waiting for you', job: 'ab12cd34', click: 'http://100.101.2.3:8484/#job=ab12cd34', urgent: true }, f)
  assert.equal(sent[0].body.click, 'http://100.101.2.3:8484/#job=ab12cd34')
  assert.equal(sent[0].body.priority, 4)
  await push(plain, { title: 'navi is done', job: 'ab12cd34' }, f)
  assert.equal(sent[1].body.priority, 3)
  assert.equal(sent[1].body.click, undefined)
})

test('PSH-7, PSH-9: Yes and No post to the answer link, and only when the push says what they allow', async () => {
  const { sent, f } = recorder()
  const answer = 'http://100.101.2.3:8484/answer/ab12cd34/' + 'k'.repeat(32)
  await push({ ...plain, detail: true }, { title: 'navi is waiting for you', job: 'ab12cd34', detail: 'rm -rf build', urgent: true, answer }, f)
  assert.deepEqual(sent[0].body.actions, [
    { action: 'http', label: 'No', url: answer, method: 'POST', body: 'no', clear: true },
    { action: 'http', label: 'Yes', url: answer, method: 'POST', body: 'yes', clear: true },
  ])
  await push(plain, { title: 'navi is waiting for you', job: 'ab12cd34', detail: 'rm -rf build', urgent: true, answer }, f)
  assert.equal(sent[1].body.actions, undefined)
  assert.doesNotMatch(JSON.stringify(sent[1].body), /answer\//)
})

test('PSH-4: a refused, unreachable or slow push says why and never throws', async (t) => {
  assert.equal(await push(plain, { title: 'x' }, recorder(403).f), 'the push server answered 403')
  assert.equal(await push({ ...plain, server: 'http://127.0.0.1:1' }, { title: 'x' }), 'the push server could not be reached')
  const slow = createServer(() => {})
  await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r))
  t.after(() => {
    slow.closeAllConnections()
    slow.close()
  })
  const started = Date.now()
  const got = await push({ ...plain, server: `http://127.0.0.1:${(slow.address() as AddressInfo).port}` }, { title: 'x' })
  assert.equal(got, 'the push server took more than 5 seconds')
  assert.ok(Date.now() - started < 7000)
})

test('PSH-5: the phone page opens the job its link names', async () => {
  const { PHONE_PAGE } = await import('../src/phone.ts')
  assert.match(PHONE_PAGE, /job=\(\[0-9a-f\]\{8\}\)/)
  assert.match(PHONE_PAGE, /open = linked/)
})

// JOB-39, PSH-19
test('the Mac and the phone each say all, waiting or off, and setting one changes only its key', () => {
  assert.deepEqual(notifyLevels({}), { mac: 'all', phone: null })
  assert.deepEqual(notifyLevels({ notify: false, push: 'https://ntfy.sh/t' }), { mac: 'off', phone: 'all' })
  assert.deepEqual(notifyLevels({ notify: 'waiting', push: { url: 'https://ntfy.sh/t', notify: false } }), { mac: 'waiting', phone: 'off' })
  assert.equal(pushConfig({ push: { url: 'https://ntfy.sh/t', notify: false } })?.off, true)

  const config = { model: 'm', notify: false, push: 'https://ntfy.sh/t' }
  assert.deepEqual(withLevels(config, { mac: 'all' }), { model: 'm', push: 'https://ntfy.sh/t' })
  assert.deepEqual(withLevels(config, { mac: 'waiting', phone: 'off' }), { model: 'm', notify: 'waiting', push: { url: 'https://ntfy.sh/t', notify: false } })
  // Back to all, a push given as its URL alone stays so.
  assert.deepEqual(withLevels(config, { phone: 'all' }), config)
  assert.deepEqual(withLevels({ push: { url: 'https://ntfy.sh/t', detail: true, notify: 'waiting' } }, { phone: 'all' }), { push: { url: 'https://ntfy.sh/t', detail: true } })
  assert.match(withLevels({ notify: false }, { phone: 'off' }) as string, /No push is set up/)
  assert.deepEqual(config, { model: 'm', notify: false, push: 'https://ntfy.sh/t' })
})
