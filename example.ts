import { generateText, streamText } from 'ai'
import { auto, generate, stream, inspect } from './src/index.ts'

// ─── 1. The whole pitch ──────────────────────────────────────────────────────
// No model name, no quant, no baseURL, no API key, no capability flags.
// `auto()` resolves on first use down a three-rung ladder: talk to a server
// that is already listening → launch an installed runtime → keyless hosted.

const { text } = await generateText({
  model: auto(),
  prompt: 'Explain a monad in one sentence.',
})
console.log(text)

// ─── 2. Streaming ────────────────────────────────────────────────────────────

const result = streamText({
  model: auto(),
  system: 'You are terse.',
  prompt: 'Why is the sky blue?',
})

for await (const delta of result.textStream) process.stdout.write(delta)
console.log()

// ─── 3. Transparency ─────────────────────────────────────────────────────────
// Zero-config must not mean zero-visibility. Three things a caller cannot
// otherwise discover: whether the prompt left the machine, whether we started a
// process that still holds memory, and what we passed over on the way.

console.log((await result.response).modelId)
console.log((await result.providerMetadata)?.neorouter)

// ─── 4. Shorthand ────────────────────────────────────────────────────────────

console.log(await generate('Name three primes.'))
for await (const chunk of stream('Count to five.')) process.stdout.write(chunk)
console.log()

// ─── 5. What it sees, and why it chose ───────────────────────────────────────
// Never required. Exists so "why is this slow / dumb / talking to the internet"
// is one call away instead of a support thread.

console.dir(await inspect(), { depth: null })

// ─── 6. Lifecycle ────────────────────────────────────────────────────────────
// Only meaningful if we launched something; servers we started are reaped here.

auto.shutdown()
