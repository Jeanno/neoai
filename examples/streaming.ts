// Streaming. `auto()` is a LanguageModelV2, so streamText works unmodified —
// including on the hosted rung, where the stream is synthesised because that
// endpoint accepts `stream: true` requests it never answers.
import { streamText } from 'ai'
import { auto } from '../src/index.ts'

const result = streamText({
  model: auto(),
  system: 'You are terse.',
  prompt: 'Why is the sky blue?',
})

for await (const delta of result.textStream) process.stdout.write(delta)
console.log()
