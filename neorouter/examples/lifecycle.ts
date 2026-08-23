// Only meaningful on the launch rung: if nothing was listening and neorouter
// started a runtime, that process is holding memory. It is reaped on exit;
// this is the manual lever for long-lived processes that want the memory back.
import { generate, shutdown } from '../src/index.ts'

console.log(await generate('say hi'))
shutdown()
