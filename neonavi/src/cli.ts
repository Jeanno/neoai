#!/usr/bin/env bun
import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { promptFrom, systemPrompt } from './args.ts'
import { makeApprover } from './approve.ts'
import { makeTools } from './tools.ts'
import { loadSession, saveSession, sessionFile, trim } from './session.ts'

const DEFAULT_STEPS = 8

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

/** Pulls `--flag value` (or a bare `--flag`) out of argv, leaving the prompt. */
function takeFlag(argv: string[], flag: string, hasValue: boolean) {
  const at = argv.indexOf(flag)
  if (at === -1) return { value: undefined, rest: argv }
  return {
    value: hasValue ? argv[at + 1] : '',
    rest: [...argv.slice(0, at), ...argv.slice(at + (hasValue ? 2 : 1))],
  }
}

async function main() {
  let argv = process.argv.slice(2)
  const steps = takeFlag(argv, '--max-steps', true)
  argv = steps.rest
  const fresh = takeFlag(argv, '--new', false)
  argv = fresh.rest

  const maxSteps = steps.value === undefined ? DEFAULT_STEPS : Number(steps.value)
  const prompt = promptFrom(argv)
  if (!prompt) {
    console.error('usage: navi <what you want done>   [--new] [--max-steps N]')
    return 1
  }

  const cwd = process.cwd()
  const file = sessionFile(cwd, homedir())
  const history = fresh.value === undefined ? trim(await loadSession(file)) : []
  if (history.length) console.error(dim(`· continuing (${history.length} messages)`))

  const messages: ModelMessage[] = [...history, { role: 'user', content: prompt }]
  const { approve, close } = makeApprover({ input: process.stdin, output: process.stdout })
  try {
    const { text, response } = await generateText({
      model: auto({ prefer: 'fast', think: false }),
      system: systemPrompt(cwd),
      tools: makeTools({ approve }),
      stopWhen: stepCountIs(maxSteps),
      messages,
      // A silent minute is indistinguishable from a hang.
      onStepFinish: ({ toolCalls }) => {
        for (const c of toolCalls) console.error(dim(`· ${c.toolName}(${JSON.stringify(c.input)})`))
      },
    })

    // Saved even when the answer came out empty: the tool results are the part
    // worth carrying forward, and a follow-up is how you recover from a bad turn.
    await saveSession(file, trim([...messages, ...response.messages]))

    if (text.trim()) {
      console.log(text)
      return 0
    }
    console.error(dim('the model returned no answer; ask again or try --new'))
    return 1
  } finally {
    close()
  }
}

process.exit(await main())
