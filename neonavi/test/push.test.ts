import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { push, pushConfig, type PushConfig } from '../src/push.ts'

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
  assert.deepEqual(pushConfig({ push: 'https://ntfy.sh/navi-abc' }), { server: 'https://ntfy.sh', topic: 'navi-abc', detail: false })
  assert.deepEqual(pushConfig({ push: { url: 'http://box.tail:2586/ntfy/mine', detail: true } }), {
    server: 'http://box.tail:2586/ntfy',
    topic: 'mine',
    detail: true,
  })
  assert.equal(pushConfig({}), undefined)
  assert.equal(pushConfig({ push: 'https://ntfy.sh/' }), undefined)
  assert.equal(pushConfig({ push: 'ftp://ntfy.sh/x' }), undefined)
  assert.equal(pushConfig({ push: 'not a url' }), undefined)
  assert.equal(pushConfig({ push: 42 }), undefined)
})

const plain: PushConfig = { server: 'https://ntfy.sh', topic: 't', detail: false }

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
