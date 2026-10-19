#!/usr/bin/env bun
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { promptFrom, startsFresh } from './args.ts'
import { parseModelSpec, resolveChain } from './spec.ts'
import { makeApprover, makeLine } from './approve.ts'
import { makeSpinner } from './spinner.ts'
import { loadSession, saveSession, sessionFile } from './session.ts'
import { createHarness, DEFAULT_STEPS, type HarnessEvent } from './harness.ts'
import { readConfig } from 'neorouter'
import { NEXT_STEP, realDeps, runSetup } from './setup.ts'

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
      'usage: navi [-p "what you want done"] [-r|--resume] [--model local|best|<provider>:<model>[,...]] [--max-steps N]\n       navi setup [--check]',
    )
    return 1
  }

  // --model overrides the config file for one run; both take the same values.
  const config = await readConfig()
  const chain = parseModelSpec(model.value ?? config.model, Object.keys(config.custom ?? {}))
  const chosen = await resolveChain(chain)
  if (!chosen) {
    console.error(
      `nothing in the model chain could be resolved: ${chain
        .map((e) => (e.provider ? `${e.provider}:${e.id ?? 'free'}` : (e.id ?? e.where)))
        .join(' → ')}`,
    )
    console.error(NEXT_STEP)
    return 1
  }

  const cwd = process.cwd()
  const file = sessionFile(cwd, homedir())
  const anew = startsFresh({ prompt: first, resume: resuming })
  const stored = anew ? [] : await loadSession(file)
  if (stored.length) console.error(dim(`· continuing (${stored.length} messages)`))

  const line = makeLine({ input: process.stdin, output: process.stdout })
  const spin = makeSpinner(process.stderr)
  const asker = makeApprover({ line })
  // On a terminal the answer is written as it arrives; a pipe gets exactly the
  // final answer, as before streaming.
  const streaming = process.stdout.isTTY === true
  // Streamed text not yet ended by a newline: anything else drawn now would
  // land on the end of it.
  let midLine = false
  const endLine = () => {
    if (midLine) process.stdout.write('\n')
    midLine = false
  }
  const harness = await createHarness({
    model: auto(chosen.options),
    contextWindow: chosen.contextWindow,
    cwd,
    config,
    maxSteps,
    // The question would otherwise be drawn beside a spinning frame.
    approve: async (command) => {
      spin.stop()
      endLine()
      const ok = await asker.approve(command)
      spin.start()
      return ok
    },
  })
  const session = harness.session(stored)

  /** A note on stderr, never over a spinner frame or the end of streamed text. */
  const note = (s: string) => {
    endLine()
    console.error(dim(s))
  }

  /** One question in, one answer out. Returns whether the model said anything. */
  const turn = async (prompt: string) => {
    let done: Extract<HarnessEvent, { type: 'done' }> | undefined
    spin.start()
    try {
      for await (const e of session.turn(prompt)) {
        if (e.type === 'done') done = e
        else if (e.type === 'text') {
          // Unstreamed text waits for the end; the spinner keeps going meanwhile.
          if (!streaming || !e.text) continue
          // Never restarted while text is streaming: the frame would draw over it.
          spin.stop()
          process.stdout.write(e.text)
          midLine = !e.text.endsWith('\n')
        } else {
          spin.stop()
          if (e.type === 'compacted') note(`· compacted ${e.messages} messages`)
          else if (e.type === 'tool-call') note(`· ${e.name}(${JSON.stringify(e.input)})`)
          else if (e.type === 'auto-approved') note(`· auto-approved: ${e.command}`)
          else if (e.type === 'error') note(`error: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
          // The model or a tool is busy again.
          endLine()
          spin.start()
        }
      }
    } finally {
      spin.stop()
    }
    endLine()
    // Saved even when the answer came out empty: the tool results are the part
    // worth carrying forward, and a follow-up is how you recover from a bad turn.
    await saveSession(file, done!.history)
    if (!done!.empty) {
      if (!streaming) console.log(done!.text)
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
