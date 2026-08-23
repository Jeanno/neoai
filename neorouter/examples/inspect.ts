// Diagnostics. Never required to make a call — this answers "why this model?"
// and "why is it talking to the internet?" without a support thread.
import { inspect } from '../src/index.ts'

console.dir(await inspect(), { depth: null })
