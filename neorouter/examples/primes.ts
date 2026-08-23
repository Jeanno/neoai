// Typed input and output. The schema is the input; `object` is typed from it,
// so no cast and no `as`. neorouter forwards the schema as response_format, so
// the backend constrains decoding rather than the SDK parsing and retrying.
import { generateObject } from 'ai'
import { z } from 'zod'
import { auto } from '../src/index.ts'

const { object } = await generateObject({
  model: auto(),
  schema: z.object({
    primes: z.array(z.number()),
    note: z.string(),
  }),
  prompt: 'Give three prime numbers and a one-line note.',
})

console.log(object)
console.log('first prime + 1 =', object.primes[0] + 1) // number at compile time
