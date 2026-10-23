#!/usr/bin/env bun
import { auto } from 'neorouter'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { commandFrom, promptFrom, startsFresh } from './args.ts'
import { parseModelSpec, walkChain, type Chosen, type Failure } from './spec.ts'
import { makeApprover, makeLine } from './approve.ts'
import { makeSpinner } from './spinner.ts'
import { serveMcp, type Ask } from './mcp.ts'
import { DEFAULT_PORT, installAgent, listen, realServeDeps, uninstallAgent } from './serve.ts'
import { ago, clearAllSessions, clearSession, listSessions, loadSession, saveSession, sessionFile } from './session.ts'
import { attach, createHarness, DEFAULT_STEPS, type Attachment, type HarnessEvent } from './harness.ts'
import { readConfig, reset } from 'neorouter'
import { CLI_NEXT_STEP, realDeps, runSetup } from './setup.ts'
import { describe, entryLabel, modelLabel } from './setup-core.ts'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

/** A tool call's input on one line, long strings such as a file's content cut short (CLI-10). */
function echo(input: unknown): string {
  return JSON.stringify(input, (_, v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}…` : v))
}
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const highlight = (s: string) => `\x1b[100;97m${s}\x1b[0m`

/** Pulls `--flag value` (or a bare `--flag`) out of argv, leaving the prompt. */
/** Every value of a repeatable flag, under any of its names (CLI-22). */
function takeAll(argv: string[], names: string[]) {
  const values: string[] = []
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (names.includes(argv[i]) && i + 1 < argv.length) values.push(argv[++i])
    else rest.push(argv[i])
  }
  return { values, rest }
}

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

// CLI-21
const HELP = [
  '/model             the model answering, and the saved chain',
  '/model <spec>      switch for this session: <provider>:<model>, local, best, or a list',
  '/attach <file>     send an image, PDF or text file with the next prompt',
  '/help              this list',
  'exit, quit, ^C, ^D leave',
].join('\n')

/** Each link that did not answer, and why (MOD-21). */
function failedLines(failures: Failure[]): string[] {
  return failures.map((f) => `${['primary', 'fallback'][f.index] ?? `link ${f.index + 1}`} (${entryLabel(f.entry)}): ${f.why}`)
}

/** `navi mcp`: navi as an MCP server over stdio (mcp.md). */
async function mcp(argv: string[]) {
  if (argv.length) {
    console.error(`unexpected: ${argv.join(' ')}`)
    console.error('usage: navi mcp')
    return 1
  }
  process.env.NEOROUTER_QUIET = '1'
  const ask: Ask = async ({ prompt, directory, attachments }) => {
    const config = await readConfig()
    const { chosen, failures } = await walkChain(parseModelSpec(config.model, Object.keys(config.custom ?? {})))
    if (!chosen) throw new Error(`navi has no model to answer with: ${failedLines(failures).join('; ')}`)
    // No approve callback: what would need a y is declined (MCP-4).
    const harness = await createHarness({ model: auto(chosen.options), contextWindow: chosen.contextWindow, cwd: directory, config })
    let done: Extract<HarnessEvent, { type: 'done' }> | undefined
    const errors: string[] = []
    for await (const e of harness.session().turn(prompt, { attachments })) {
      if (e.type === 'done') done = e
      else if (e.type === 'error') errors.push(e.error instanceof Error ? e.error.message : String(e.error))
    }
    if (!done || done.empty) throw new Error(errors[0] ?? 'the model returned no answer')
    return { text: done.text, model: modelLabel(chosen) }
  }
  await serveMcp(ask, { input: process.stdin, output: process.stdout })
  return 0
}

/** `navi serve [--port N]`: the chain as an OpenAI-compatible server (serve.md). */
async function serve(argv: string[]) {
  const install = takeFlag(argv, '--install', false)
  const uninstall = takeFlag(install.rest, '--uninstall', false)
  const port = takeFlag(uninstall.rest, '--port', true)
  const n = port.value === undefined ? DEFAULT_PORT : Number(port.value)
  if (port.rest.length || !Number.isInteger(n) || n < 1 || n > 65535 || (install.value !== undefined && uninstall.value !== undefined)) {
    if (port.rest.length) console.error(`unexpected: ${port.rest.join(' ')}`)
    else if (!Number.isInteger(n) || n < 1 || n > 65535) console.error(`not a port: ${port.value}`)
    console.error('usage: navi serve [--port N] [--install | --uninstall]')
    return 1
  }
  // SRV-8: kept running by launchd instead of this terminal.
  if (uninstall.value !== undefined) {
    console.log((await uninstallAgent(homedir())) ? 'Stopped navi serve and removed it from login.' : 'navi serve was not set to run at login.')
    return 0
  }
  if (install.value !== undefined) {
    const got = await installAgent(homedir(), n)
    if ('problem' in got) {
      console.error(got.problem)
      return 1
    }
    console.log(`navi serve now runs in the background and at every login, on ${bold(`http://127.0.0.1:${n}/v1`)}.`)
    console.log(dim(`Log: ${got.log} · stop it with \`navi serve --uninstall\``))
    // Started by launchd, it gets none of this shell's exports.
    if (got.unsaved.length)
      console.error(`${got.unsaved.join(', ')} ${got.unsaved.length > 1 ? 'are' : 'is'} set in this shell but not saved; navi serve will not see ${got.unsaved.length > 1 ? 'them' : 'it'}. Save keys with \`navi setup\`.`)
    return 0
  }
  // Each request is logged on its own line (SRV-6); the router's line would interleave.
  process.env.NEOROUTER_QUIET = '1'
  const config = await readConfig()
  const custom = Object.keys(config.custom ?? {})
  const chain = parseModelSpec(config.model, custom)
  const { chosen, failures } = await walkChain(chain)
  if (chosen) console.error(describe({ ...chosen, label: modelLabel(chosen) }))
  else console.error(`No model answers yet; requests will get a 503 until one does.`)
  for (const line of failedLines(failures)) console.error(dim(`· ${line}`))
  try {
    await listen(chain, realServeDeps((line) => console.error(dim(`${new Date().toLocaleTimeString()} ${line}`))), n)
  } catch (e) {
    const busy = (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
    console.error(busy ? `Port ${n} is in use; choose another with --port.` : `navi serve: ${(e as Error).message}`)
    return 1
  }
  console.error(`\nServing on ${bold(`http://127.0.0.1:${n}/v1`)}: give apps that base URL, any API key, and the model ${bold('navi')}.`)
  console.error(dim('Only this computer can reach it. ^C stops it.'))
  // Runs until stopped: the open server keeps the process alive.
  return new Promise<number>(() => {})
}

/** `navi sessions [clear [<directory> | --all]]` (SES-13, SES-14). */
async function sessions(argv: string[]) {
  const home = homedir()
  const cwd = process.cwd()
  const tilde = (p: string) => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
  if (!argv.length) {
    const all = await listSessions(home)
    if (!all.length) {
      console.log('No saved conversations yet.')
      return 0
    }
    const here = sessionFile(cwd, home)
    for (const s of all) {
      const mark = s.file === here ? '*' : ' '
      const where = s.cwd ? tilde(s.cwd) : `(directory unknown) ${s.file}`
      console.log(`${mark} ${where}  ${dim(`${s.messages} messages · ${ago(s.used)}`)}`)
    }
    console.log(dim('\n* this directory · clear one with `navi sessions clear [<directory>]`, all with `--all`'))
    return 0
  }
  if (argv[0] === 'clear' && argv.length <= 2) {
    if (argv[1] === '--all') {
      const n = await clearAllSessions(home)
      console.log(n ? `Deleted ${n} saved conversation${n === 1 ? '' : 's'}.` : 'There were no saved conversations.')
      return 0
    }
    // Saved under the real path, as process.cwd() gives it: /tmp is /private/tmp on macOS.
    const typed = resolve(cwd, argv[1] ?? '.')
    const dir = await realpath(typed).catch(() => typed)
    const had = await clearSession(dir, home)
    console.log(had ? `Deleted the conversation saved for ${tilde(dir)}.` : `No conversation is saved for ${tilde(dir)}.`)
    return 0
  }
  console.error(`unexpected: ${argv.join(' ')}`)
  console.error('usage: navi sessions [clear [<directory> | --all]]')
  return 1
}

async function main() {
  let argv = process.argv.slice(2)
  if (argv[0] === 'setup') return setup(argv.slice(1))
  if (argv[0] === 'sessions') return sessions(argv.slice(1))
  if (argv[0] === 'serve') return serve(argv.slice(1))
  if (argv[0] === 'mcp') return mcp(argv.slice(1))
  const steps = takeFlag(argv, '--max-steps', true)
  argv = steps.rest
  const resume = takeFlag(argv, '--resume', false)
  argv = resume.rest
  const r = takeFlag(argv, '-r', false)
  argv = r.rest
  const resuming = resume.value !== undefined || r.value !== undefined
  const model = takeFlag(argv, '--model', true)
  argv = model.rest
  const attaching = takeAll(argv, ['-a', '--attach'])
  argv = attaching.rest

  // A terminal gets a conversation; a pipe gets one answer and the prompt is
  // the only place it can come from.
  const interactive = process.stdin.isTTY === true
  const maxSteps = steps.value === undefined ? DEFAULT_STEPS : Number(steps.value)
  const { prompt: first, stray } = promptFrom(argv)
  if (stray.length || (!first && !interactive)) {
    if (stray.length) console.error(`unexpected: ${stray.join(' ')}`)
    console.error(
      'usage: navi [-p "what you want done"] [-a file]... [-r|--resume] [--model local|best|<provider>:<model>[,...]] [--max-steps N]\n       navi setup [--check]\n       navi sessions [clear [<directory> | --all]]\n       navi serve [--port N] [--install | --uninstall]\n       navi mcp',
    )
    return 1
  }

  // Read before any model is looked for: a bad path should not cost a model start (CLI-22).
  let pending: Attachment[] = []
  for (const path of attaching.values) {
    try {
      pending.push(await attach(path))
    } catch (e) {
      console.error(`navi: ${(e as Error).message}`)
      return 1
    }
  }

  // --model overrides the config file for one run; both take the same values.
  const config = await readConfig()
  const custom = Object.keys(config.custom ?? {})
  const saved = parseModelSpec(config.model, custom)
  let chain = model.value === undefined ? saved : parseModelSpec(model.value, custom)
  const { chosen, failures } = await walkChain(chain)
  if (!chosen) {
    console.error('navi has no model to answer with:')
    for (const line of failedLines(failures)) console.error(`  ${line}`)
    console.error(CLI_NEXT_STEP)
    return 1
  }
  // Why each earlier link did not answer (MOD-21): on stderr, so pipes still
  // get exactly the answer.
  for (const line of failedLines(failures)) console.error(dim(`· ${line}`))

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
  const harnessFor = (chosen: Chosen) => createHarness({
    model: auto(chosen.options),
    contextWindow: chosen.contextWindow,
    cwd,
    config,
    maxSteps,
    // The question would otherwise be drawn beside a spinning frame.
    approve: async (command, { change }) => {
      spin.stop()
      endLine()
      const ok = change ? await asker.approveChange(command, change) : await asker.approve(command)
      spin.start()
      return ok
    },
  })
  let answering = chosen
  let session = (await harnessFor(chosen)).session(stored)

  /** CLI-20: what answers and the saved chain, or a switch that keeps the conversation. */
  const switchModel = async (spec: string) => {
    if (!spec) {
      console.error(describe({ ...answering, label: modelLabel(answering) }))
      console.error(dim(`saved chain: ${saved.map(entryLabel).join(' → ')}`))
      if (chain !== saved) console.error(dim(`this session: ${chain.map(entryLabel).join(' → ')}`))
      console.error(dim('switch with /model <provider>:<model>, local, best, or a list separated by commas'))
      return
    }
    // Looked at afresh: the user may have just started the server that failed.
    reset()
    const wanted = parseModelSpec(spec, custom)
    const next = await walkChain(wanted)
    if (!next.chosen) {
      console.error(`nothing in ${spec} answers, so the model stays ${modelLabel(answering)}:`)
      for (const line of failedLines(next.failures)) console.error(`  ${line}`)
      return
    }
    answering = next.chosen
    chain = wanted
    session = (await harnessFor(answering)).session(session.history)
    console.error(describe({ ...answering, label: modelLabel(answering) }))
  }

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
      // Attachments go with the next prompt only (CLI-22, CLI-23).
      const attachments = pending
      pending = []
      for await (const e of session.turn(prompt, { attachments })) {
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
          else if (e.type === 'tool-call') note(`· ${e.name}(${echo(e.input)})`)
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
    await saveSession(file, done!.history, cwd)
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
    if (!first) console.error(dim('navi · ask anything; /help for commands; exit, ^C or ^D to leave'))
    for (;;) {
      // The marker gets a lighter background; bold is opened as part of the
      // prompt so the typed line inherits it.
      const prompt = (await line.ask(`\n${highlight('navi>')} \x1b[1m`))?.trim()
      // Reset the bold, and a blank line between what was asked and what comes back.
      if (process.stdout.isTTY) process.stdout.write('\x1b[0m\n')
      if (prompt === undefined || prompt === null || QUIT.has(prompt.toLowerCase())) return 0
      if (!prompt) continue
      const command = commandFrom(prompt)
      if (command?.name === 'model') await switchModel(command.spec)
      else if (command?.name === 'help') console.error(HELP)
      else if (command?.name === 'attach' && !command.path) console.error('usage: /attach <file>')
      else if (command?.name === 'attach') {
        try {
          const a = await attach(command.path)
          pending.push(a)
          console.error(dim(`· attached ${a.name}; it goes with your next prompt`))
        } catch (e) {
          console.error(`can't attach: ${(e as Error).message}`)
        }
      }
      else await turn(prompt)
    }
  } finally {
    line.close()
  }
}

process.exit(await main())
