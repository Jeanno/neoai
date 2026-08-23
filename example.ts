import { generate } from './src/helpers.ts'

// One line to run a prompt and get the text back. No model name, no config.
const text = await generate('How many "r"s are in "strawberry"?')
console.log(text)
