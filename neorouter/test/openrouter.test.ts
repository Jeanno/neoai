import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogIds, contextLength, freeChatModels, prices } from '../src/hosted.ts'

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

// A pinned id must be checked against the catalogue. Accepting a typo as
// resolved defeats the chain: the link "succeeds" and nothing falls through.
test('the catalogue lists every id, not only the free ones', () => {
  assert.deepEqual(catalogIds(catalog).sort(), [
    'audio/lyria:free',
    'nvidia/big:free',
    'paid/good',
    'small/tiny:free',
    'stealth/multi:free',
  ])
})

test('an unexpected catalogue shape lists nothing', () => {
  assert.deepEqual(catalogIds(null as any), [])
})

test('the context window comes from the catalogue, with a floor when unknown', () => {
  const catalog = { data: [{ id: 'z-ai/glm-5.3-flash', context_length: 1310720 }, { id: 'x/y' }] }
  assert.equal(contextLength(catalog, 'z-ai/glm-5.3-flash'), 1310720)
  assert.equal(contextLength(catalog, 'x/y'), 8192)
  assert.equal(contextLength(null, 'x/y'), 8192)
})

test('prices are per million tokens, in the order asked, and drop missing ids', () => {
  const catalog = {
    data: [
      { id: 'b/two', pricing: { prompt: '0.000002', completion: '0.00001' } },
      { id: 'a/one', pricing: { prompt: '0.00000006', completion: '0.00000012' } },
    ],
  }
  assert.deepEqual(prices(catalog, ['a/one', 'gone/model', 'b/two']), [
    { id: 'a/one', input: 0.06, output: 0.12 },
    { id: 'b/two', input: 2, output: 10 },
  ])
  assert.deepEqual(prices(null, ['a/one']), [])
})
