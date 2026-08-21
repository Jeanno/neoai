// Zero-config must not mean zero-visibility. Every result carries the full
// resolution: which rung ran, whether the prompt stayed on this machine, and
// which candidates lost — with reasons, since you cannot override the choice.
import { generateText } from 'ai'
import { auto } from '../src/index.ts'

const { text, providerMetadata, response } = await generateText({
  model: auto(),
  prompt: 'Name three primes.',
})

console.log(text)
console.log('\nmodel:', response.modelId)
console.dir(providerMetadata?.neorouter, { depth: null })
