// The same engine without the AI SDK imports, for the 80% case.
import { generate, stream } from '../src/index.ts'

console.log(await generate('Name three primes.'))

for await (const chunk of stream('Count to five.')) process.stdout.write(chunk)
console.log()
