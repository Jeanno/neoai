#!/usr/bin/env bun
import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { readdir } from 'node:fs/promises'
import { promptFrom, startsFresh, systemPrompt } from './args.ts'
import { parseModelSpec, resolveChain } from './spec.ts'
import { gated, makeApprover, makeLine } from './approve.ts'
import { judge } from './judge.ts'
import { makeTools } from './tools.ts'
import { makeSpinner } from './spinner.ts'
import { loadSession, saveSession, sessionFile } from './session.ts'
import { compact, estimateTokens } from './compact.ts'
import { collectContext } from './context.ts'
import { readConfig } from 'neorouter'
import { NEXT_STEP, realDeps, runSetup } from './setup.ts'

const DEFAULT_STEPS = 32

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const highlight = (s: string) => `\x1b[100;97m${s}\x1b[0m`

/** Pulls `--flag value` (or a bare `--flag`) out of argv, leaving the prompt. */
function takeFlag(argv: string[], flag: string, hasValue: boolean) {
  const at = argv.indexOf(flag)
  if (at === -1) return { value: undefined, rest: argv }
  return {
    value: hasValue ? argv[at + 1] : '',
    rest: [...argv.slice(0, at), ...argv.slice(at + (hasValue ? 2 : 1))],
  }
}

/** `navi setup [--check]`: getting a first model working (setup.md). */
async function setup(argv: string[]) {
  const check = takeFlag(argv, '--check', false)
  if (check.rest.length) {
    console.error(`unexpected: ${check.rest.join(' ')}`)
    console.error('usage: navi setup [--check]')
    return 1
  }
  // Setup reports the backend itself; the router's own line would say it twice.
  process.env.NEOROUTER_QUIET = '1'
  const line = makeLine({ input: process.stdin, output: process.stdout })
  try {
    const deps = realDeps({
      ask: (q) => line.ask(q),
      askSecret: (q) => line.ask(q, { secret: true }),
      print: (s) => console.log(s),
    })
    // Nobody at a pipe to answer the questions, so only report (SET-3).
    return await runSetup(deps, { check: check.value !== undefined || process.stdin.isTTY !== true })
  } finally {
    line.close()
  }
}

/** Typed at the prompt to leave; ^C and ^D work too. */
const QUIT = new Set(['exit', 'quit', 'q'])

async function main() {
  let argv = process.argv.slice(2)
  if (argv[0] === 'setup') return setup(argv.slice(1))
  const steps = takeFlag(argv, '--max-steps', true)
  argv = steps.rest
  const resume = takeFlag(argv, '--resume', false)
  argv = resume.rest
  const r = takeFlag(argv, '-r', false)
  argv = r.rest
  const resuming = resume.value !== undefined || r.value !== undefined
  const model = takeFlag(argv, '--model', true)
  argv = model.rest

  // A terminal gets a conversation; a pipe gets one answer and the prompt is
  // the only place it can come from.
  const interactive = process.stdin.isTTY === true
  const maxSteps = steps.value === undefined ? DEFAULT_STEPS : Number(steps.value)
  const { prompt: first, stray } = promptFrom(argv)
  if (stray.length || (!first && !interactive)) {
    if (stray.length) console.error(`unexpected: ${stray.join(' ')}`)
    console.error(
      'usage: navi [-p "what you want done"] [-r|--resume] [--model remote|local|free|<id>[,...]] [--max-steps N]\n       navi setup [--check]',
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
    console.error(NEXT_STEP)
    return 1
  }

  const cwd = process.cwd()
  const entries = await readdir(cwd).catch(() => [])
  const context = await collectContext(cwd)
  const file = sessionFile(cwd, homedir())
  const anew = startsFresh({ prompt: first, resume: resuming })
  let messages: ModelMessage[] = anew ? [] : await loadSession(file)
  if (messages.length) console.error(dim(`· continuing (${messages.length} messages)`))

  const line = makeLine({ input: process.stdin, output: process.stdout })
  const spin = makeSpinner(process.stderr)
  const asker = makeApprover({ line })
  const llm = auto(chosen.options)
  // What the user asked this turn: the judge reads the command in its light.
  let intent = ''
  const approve = gated({
    judge: (command) => judge(llm, command, intent),
    mode: config.approve,
    onAuto: (command) => {
      spin.stop()
      console.error(dim(`· auto-approved: ${command}`))
      spin.start()
    },
    // The question would otherwise be drawn beside a spinning frame.
    ask: async (command) => {
      spin.stop()
      const ok = await asker.approve(command)
      spin.start()
      return ok
    },
  })
  // On unless the config says otherwise; off keeps everything but the model on the machine.
  const web = config.web_search !== false
  const system = systemPrompt(cwd, entries, context, web)
  const tools = makeTools({ approve }, { web })

  /** One question in, one answer out. Returns whether the model said anything. */
  const systemTokens = estimateTokens([{ role: 'system', content: system }])
  const turn = async (prompt: string) => {
    intent = prompt
    spin.start()
    const packed = await compact(llm, messages, { contextWindow: chosen.contextWindow, extraTokens: systemTokens })
    if (packed.compacted) {
      spin.stop()
      console.error(dim(`· compacted ${packed.compacted} messages`))
      spin.start()
    }
    messages = [...packed.messages, { role: 'user', content: prompt }]
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
    messages = [...messages, ...response.messages]
    await saveSession(file, messages)
    if (text.trim()) {
      console.log(text)
      return true
    }
    console.error(dim('the model returned no answer; ask again'))
    return false
  }

  try {
    if (first) {
      const answered = await turn(first)
      if (!interactive) return answered ? 0 : 1
    }
    if (!first) console.error(dim('navi · ask anything; exit, ^C or ^D to leave'))
    for (;;) {
      // The marker gets a lighter background; bold is opened as part of the
      // prompt so the typed line inherits it.
      const prompt = (await line.ask(`\n${highlight('navi>')} \x1b[1m`))?.trim()
      // Reset the bold, and a blank line between what was asked and what comes back.
      if (process.stdout.isTTY) process.stdout.write('\x1b[0m\n')
      if (prompt === undefined || prompt === null || QUIT.has(prompt.toLowerCase())) return 0
      if (!prompt) continue
      await turn(prompt)
    }
  } finally {
    line.close()
  }
}

process.exit(await main())
