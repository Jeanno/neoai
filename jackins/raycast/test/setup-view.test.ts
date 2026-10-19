import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Answering, Choice, ProviderRow, Status } from 'neonavi/setup'
import { modelLabel, whereLabel } from '../src/lib/labels.ts'
import { choiceItems, providerAccessory, relabel, slotItems, statusMarkdown } from '../src/lib/setup-view.ts'

const local: Answering = {
  entry: { where: 'local', prefer: 'fast' },
  index: 0,
  options: { think: false, scope: 'local', prefer: 'fast' },
  contextWindow: 8192,
  backend: 'lmstudio',
  modelId: 'qwen3-4b',
  local: true,
  label: 'lmstudio · qwen3-4b',
}

const remote: Answering = {
  ...local,
  entry: { where: 'remote', provider: 'anthropic', id: 'claude-sonnet-5-5' },
  index: 1,
  options: { think: false, provider: 'anthropic', model: 'claude-sonnet-5-5' },
  backend: 'anthropic',
  modelId: 'claude-sonnet-5-5',
  local: false,
  label: 'Anthropic · claude-sonnet-5-5',
}

const status = (answering: Answering | null, extra: Partial<Status> = {}): Status => ({
  primary: { value: 'local', label: 'any local model (fastest)' },
  fallback: null,
  later: [],
  answering,
  ...extra,
})

test('RAY-6: the slots show primary and fallback, marking the one that answers', () => {
  assert.deepEqual(slotItems(status(local)), [
    { slot: 0, title: 'Primary', subtitle: 'any local model (fastest)', answers: true },
    { slot: 1, title: 'Fallback', subtitle: 'none', answers: false },
  ])
  const later = slotItems(
    status(remote, {
      fallback: { value: 'anthropic:claude-sonnet-5-5', label: 'claude-sonnet-5-5 on Anthropic' },
      later: [{ value: 'best', label: 'the largest local model' }],
    }),
  )
  assert.deepEqual(
    later.map((i) => [i.slot, i.title, i.answers]),
    [
      [0, 'Primary', false],
      [1, 'Fallback', true],
      [null, 'Then (3)', false],
    ],
  )
})

test('RAY-9: a local model is named by its id, never the app serving it', () => {
  assert.equal(modelLabel(local), 'qwen3-4b')
  assert.equal(relabel(local)?.label, 'qwen3-4b')
  assert.equal(modelLabel(remote), 'Anthropic · claude-sonnet-5-5')
  assert.equal(
    whereLabel({ label: 'Anthropic · claude-sonnet-5-5', local: false }),
    'Anthropic · claude-sonnet-5-5 (remote)',
  )
  assert.doesNotMatch(statusMarkdown(status(local)), /lmstudio/)
})

test('RAY-9: local choices drop the server the core names in their detail', () => {
  const choices: Choice[] = [
    { value: 'local:qwen3-4b', label: 'qwen3-4b', detail: 'lmstudio', current: false },
    { value: 'local', label: 'any local model (fastest)', current: true },
  ]
  assert.deepEqual(choiceItems(choices, { local: true }), [
    { id: 'local:qwen3-4b', value: 'local:qwen3-4b', title: 'qwen3-4b', subtitle: undefined, current: false },
    { id: 'local', value: 'local', title: 'any local model (fastest)', subtitle: undefined, current: true },
  ])
  // Provider models keep theirs: a context size.
  assert.equal(
    choiceItems([{ value: 'openai:gpt', label: 'gpt', detail: '128k context', current: false }])[0].subtitle,
    '128k context',
  )
  assert.equal(choiceItems([{ value: null, label: 'none', current: false }])[0].id, 'none')
})

test('RAY-6: providers say where their key comes from (SET-19)', () => {
  const p: ProviderRow = { id: 'openai', name: 'OpenAI', keyPage: 'https://x', env: 'OPENAI_API_KEY', key: null }
  assert.equal(providerAccessory(p), undefined)
  assert.equal(providerAccessory({ ...p, key: 'saved' }), 'key saved')
  assert.equal(providerAccessory({ ...p, key: 'env' }), 'key from OPENAI_API_KEY')
})

test('RAY-6: the status says what answers, then the test reply or error (SET-11)', () => {
  assert.match(statusMarkdown(status(remote)), /\*\*Anthropic · claude-sonnet-5-5\*\*, the fallback \(REMOTE/)
  assert.match(statusMarkdown(status(local), { state: 'asking' }), /Asking it a test question/)
  assert.match(
    statusMarkdown(status(local), { state: 'done', ok: true, reply: 'Hello!' }),
    /\*\*Test reply:\*\* Hello!/,
  )
  assert.match(
    statusMarkdown(status(local), { state: 'done', ok: false, error: 'timed out' }),
    /didn't answer:\*\* timed out/,
  )
})

test('RAY-7: with nothing answering, the status says so and what to do', () => {
  const out = statusMarkdown(status(null))
  assert.match(out, /can't find a model/)
  assert.match(out, /Choose a model for the primary slot/)
})
