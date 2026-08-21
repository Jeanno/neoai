import { generateText } from 'ai'
import { auto } from './src/index.ts'

// No model name, no quant, no baseURL, no API key. `auto()` resolves a backend
// on first use and reports on stderr which one answered.
const { text } = await generateText({
  model: auto(),
  prompt: 'Explain a monad in one sentence.',
})

console.log(text)
