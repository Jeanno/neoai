#!/usr/bin/env -S npx tsx
import { generateText, stepCountIs } from 'ai'
import { auto } from 'neorouter'
import { promptFrom, systemPrompt } from './args.ts'
import { makeApprover } from './approve.ts'
import { makeTools } from './tools.ts'

const DEFAULT_STEPS = 8

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

async function main() {
  const argv = process.argv.slice(2)
  const stepsAt = argv.indexOf('--max-steps')
  const maxSteps = stepsAt === -1 ? DEFAULT_STEPS : Number(argv[stepsAt + 1])
  const rest = stepsAt === -1 ? argv : [...argv.slice(0, stepsAt), ...argv.slice(stepsAt + 2)]

  const prompt = promptFrom(rest)
  if (!prompt) {
    console.error('usage: navi <what you want done>')
    return 1
  }

  const { approve, close } = makeApprover({ input: process.stdin, output: process.stdout })
  try {
    const { text, steps } = await generateText({
      model: auto({ prefer: 'fast', think: false }),
      system: systemPrompt(process.cwd()),
      tools: makeTools({ approve }),
      stopWhen: stepCountIs(maxSteps),
      prompt,
      // A silent minute is indistinguishable from a hang.
      onStepFinish: ({ toolCalls }) => {
        for (const c of toolCalls) console.error(dim(`· ${c.toolName}(${JSON.stringify(c.input)})`))
      },
    })

    if (text.trim()) {
      console.log(text)
      return 0
    }
    // Ran out of steps mid-loop: say so and fail, rather than print nothing and
    // exit 0 as though the task were done.
    console.error(
      dim(`no answer after ${steps.length} steps; raise the ceiling with --max-steps`),
    )
    return 1
  } finally {
    close()
  }
}

process.exit(await main())
