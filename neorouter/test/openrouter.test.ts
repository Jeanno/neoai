import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freeChatModels } from '../src/hosted.ts'

const catalog = {
  data: [
    {
      id: 'audio/lyria:free',
      pricing: { prompt: '0', completion: '0' },
      context_length: 1048576,
      architecture: { modality: 'text->audio' },
    },
    {
      id: 'nvidia/big:free',
      pricing: { prompt: '0', completion: '0' },
      context_length: 1000000,
      architecture: { modality: 'text->text' },
    },
    {
      // ox-alpha's shape: takes images, answers in text. Filtering on an exact
      // 'text->text' modality would drop the best free model on offer.
      id: 'stealth/multi:free',
      pricing: { prompt: '0', completion: '0' },
      context_length: 1048576,
      architecture: { modality: 'text+image+video->text' },
    },
    {
      id: 'small/tiny:free',
      pricing: { prompt: '0', completion: '0' },
      context_length: 8192,
      architecture: { modality: 'text->text' },
    },
    {
      id: 'paid/good',
      pricing: { prompt: '0.000003', completion: '0.000015' },
      context_length: 2000000,
      architecture: { modality: 'text->text' },
    },
  ],
}

test('leaves out anything that costs money', () => {
  assert.ok(!freeChatModels(catalog).includes('paid/good'))
})

// Lyria is a music model: free, enormous context, and no use for a chat prompt.
test('leaves out models that do not answer text', () => {
  assert.ok(!freeChatModels(catalog).includes('audio/lyria:free'))
})

test('keeps a model that takes images but answers in text', () => {
  assert.ok(freeChatModels(catalog).includes('stealth/multi:free'))
})

test('puts the roomiest free chat model first', () => {
  assert.deepEqual(freeChatModels(catalog), [
    'stealth/multi:free',
    'nvidia/big:free',
    'small/tiny:free',
  ])
})

test('an unexpected catalogue shape yields nothing rather than throwing', () => {
  assert.deepEqual(freeChatModels({} as any), [])
  assert.deepEqual(freeChatModels(null as any), [])
})
