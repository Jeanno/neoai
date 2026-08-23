#!/usr/bin/env bun
import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { readdir } from 'node:fs/promises'
import { promptFrom, systemPrompt } from './args.ts'
import { parseModelSpec, resolveChain } from './spec.ts'
import { makeApprover } from './approve.ts'
import { makeTools } from './tools.ts'
import { loadSession, saveSession, sessionFile, trim } from './session.ts'
import { collectContext } from './context.ts'
import { readConfig } from 'neorouter'

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
  const model = takeFlag(argv, '--model', true)
  argv = model.rest

  // --model overrides the config file for one run; both take the same values.
  const config = await readConfig()
  const chain = parseModelSpec(model.value ?? config.model)
  const chosen = await resolveChain(chain)
  if (!chosen) {
    console.error(
      `nothing in the model chain could be resolved: ${chain
        .map((e) => e.id ?? e.where)
        .join(' → ')}`,
    )
    return 1
  }

  const maxSteps = steps.value === undefined ? DEFAULT_STEPS : Number(steps.value)
  const prompt = promptFrom(argv)
  if (!prompt) {
    console.error(
      'usage: navi <what you want done>   [--new] [--model remote|local|<id>[,...]] [--max-steps N]',
    )
    return 1
  }

  const cwd = process.cwd()
  const entries = await readdir(cwd).catch(() => [])
  const context = await collectContext(cwd)
  const file = sessionFile(cwd, homedir())
  const history = fresh.value === undefined ? trim(await loadSession(file)) : []
  if (history.length) console.error(dim(`· continuing (${history.length} messages)`))

  const messages: ModelMessage[] = [...history, { role: 'user', content: prompt }]
  const { approve, close } = makeApprover({ input: process.stdin, output: process.stdout })
  try {
    const { text, response } = await generateText({
      model: auto(chosen.options),
      system: systemPrompt(cwd, entries, context),
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
