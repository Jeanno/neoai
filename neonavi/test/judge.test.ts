import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { judge, judgePrompt, parseVerdict } from '../src/judge.ts'

// A hand-rolled fake: `ai/test` drags in msw, which the repo does not need.
function fake(doGenerate: LanguageModelV2['doGenerate']): LanguageModelV2 {
  return {
    specificationVersion: 'v2',
    provider: 'fake',
    modelId: 'fake',
    supportedUrls: {},
    doGenerate,
    doStream: async () => {
      throw new Error('not streamed')
    },
  }
}

function saying(text: string) {
  return fake(async () => ({
    content: [{ type: 'text', text }],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    warnings: [],
  }))
}

// TL-19
test('a bare SAFE or UNSAFE line is the verdict, case-insensitive', () => {
  assert.equal(parseVerdict('SAFE'), 'safe')
  assert.equal(parseVerdict('unsafe\n'), 'unsafe')
  assert.equal(parseVerdict('**Safe**'), 'safe')
})

test('the last verdict line wins over earlier reasoning', () => {
  assert.equal(parseVerdict('It looks SAFE at first.\nUNSAFE'), 'unsafe')
})

test('hedged or chatty replies are unknown', () => {
  assert.equal(parseVerdict('Probably safe, but check.'), 'unknown')
  assert.equal(parseVerdict('SAFE UNSAFE'), 'unknown')
  assert.equal(parseVerdict(''), 'unknown')
})

// TL-18, TL-21
test('the judge sees both the command and the intent', () => {
  const p = judgePrompt('rm -rf build', 'delete the build dir')
  assert.match(p, /rm -rf build/)
  assert.match(p, /delete the build dir/)
})

test('a model saying SAFE yields safe', async () => {
  assert.equal(await judge(saying('SAFE'), 'ls', 'list files'), 'safe')
})

// TL-20
test('a model error is unknown, not a throw', async () => {
  const broken = fake(async () => {
    throw new Error('network down')
  })
  assert.equal(await judge(broken, 'ls', 'list files'), 'unknown')
})
