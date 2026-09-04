#!/usr/bin/env bun
import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { readdir } from 'node:fs/promises'
import { promptFrom, systemPrompt } from './args.ts'
import { parseModelSpec, resolveChain } from './spec.ts'
import { makeApprover, makeLine } from './approve.ts'
import { makeTools } from './tools.ts'
import { makeSpinner } from './spinner.ts'
import { loadSession, saveSession, sessionFile, trim } from './session.ts'
import { collectContext } from './context.ts'
import { readConfig } from 'neorouter'

const DEFAULT_STEPS = 32

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

/** Pulls `--flag value` (or a bare `--flag`) out of argv, leaving the prompt. */
function takeFlag(argv: string[], flag: string, hasValue: boolean) {
  const at = argv.indexOf(flag)
  if (at === -1) return { value: undefined, rest: argv }
  return {
    value: hasValue ? argv[at + 1] : '',
    rest: [...argv.slice(0, at), ...argv.slice(at + (hasValue ? 2 : 1))],
  }
}

/** Typed at the prompt to leave; ^C and ^D work too. */
const QUIT = new Set(['exit', 'quit', 'q'])

async function main() {
  let argv = process.argv.slice(2)
  const steps = takeFlag(argv, '--max-steps', true)
  argv = steps.rest
  const fresh = takeFlag(argv, '--new', false)
  argv = fresh.rest
  const model = takeFlag(argv, '--model', true)
  argv = model.rest

  // A terminal gets a conversation; a pipe gets one answer and the prompt is
  // the only place it can come from.
  const interactive = process.stdin.isTTY === true
  const maxSteps = steps.value === undefined ? DEFAULT_STEPS : Number(steps.value)
  const first = promptFrom(argv)
  if (!first && !interactive) {
    console.error(
      'usage: navi [what you want done]   [--new] [--model remote|local|<id>[,...]] [--max-steps N]',
    )
    return 1
  }

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

  const cwd = process.cwd()
  const entries = await readdir(cwd).catch(() => [])
  const context = await collectContext(cwd)
  const file = sessionFile(cwd, homedir())
  let messages: ModelMessage[] = fresh.value === undefined ? trim(await loadSession(file)) : []
  if (messages.length) console.error(dim(`· continuing (${messages.length} messages)`))

  const line = makeLine({ input: process.stdin, output: process.stdout })
  const spin = makeSpinner(process.stderr)
  const asker = makeApprover({ line })
  // The question would otherwise be drawn beside a spinning frame.
  const approve = async (command: string) => {
    spin.stop()
    const ok = await asker.approve(command)
    spin.start()
    return ok
  }
  const llm = auto(chosen.options)
  const system = systemPrompt(cwd, entries, context)
  const tools = makeTools({ approve })

  /** One question in, one answer out. Returns whether the model said anything. */
  const turn = async (prompt: string) => {
    messages = [...messages, { role: 'user', content: prompt }]
    spin.start()
    const { text, response } = await generateText({
      model: llm,
      system,
      tools,
      stopWhen: stepCountIs(maxSteps),
      messages,
      // A silent minute is indistinguishable from a hang.
      onStepFinish: ({ toolCalls, finishReason }) => {
        spin.stop()
        for (const c of toolCalls) console.error(dim(`· ${c.toolName}(${JSON.stringify(c.input)})`))
        // The last step is followed by the answer, not another call.
        if (finishReason === 'tool-calls') spin.start()
      },
    }).finally(spin.stop)
    // Saved even when the answer came out empty: the tool results are the part
    // worth carrying forward, and a follow-up is how you recover from a bad turn.
    messages = trim([...messages, ...response.messages])
    await saveSession(file, messages)
    if (text.trim()) {
      console.log(text)
      return true
    }
    console.error(dim('the model returned no answer; ask again or try --new'))
    return false
  }

  try {
    if (first) {
      const answered = await turn(first)
      if (!interactive) return answered ? 0 : 1
    }
    if (!first) console.error(dim('navi · ask anything; exit, ^C or ^D to leave'))
    for (;;) {
      // Bold is opened as part of the prompt so the typed line inherits it.
      const prompt = (await line.ask(`\n${bold('navi>')} \x1b[1m`))?.trim()
      if (process.stdout.isTTY) process.stdout.write('\x1b[0m')
      if (prompt === undefined || prompt === null || QUIT.has(prompt.toLowerCase())) return 0
      if (!prompt) continue
      await turn(prompt)
    }
  } finally {
    line.close()
  }
}

process.exit(await main())
