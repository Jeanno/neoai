import { stepCountIs, streamText, type LanguageModel, type ModelMessage } from 'ai'
import { configDir, readConfig } from 'neorouter'
import { readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { systemPrompt, today } from './args.ts'
import { collectContext } from './context.ts'
import { memorySection, projectRoot, readMemory } from './memory.ts'
import { makeRecorder, takeNote } from './undo.ts'
import { allowCommand, gated, type Answer } from './approve.ts'
import { judge } from './judge.ts'
import { makeTools } from './tools.ts'
import { summarize, type FileChange } from './diff.ts'

export type { FileChange } from './diff.ts'
import { compact, estimateTokens } from './compact.ts'
import { userContent, type Attachment } from './attach.ts'

export { attach, splitUserContent, type Attachment } from './attach.ts'
import { searchBackend } from './web.ts'
import { CORRECTION_WINDOW, readsAsCorrection, record, type LedgerEntry } from './ledger.ts'
import type { Tab } from './browser.ts'
export { allowable, type Answer } from './approve.ts'

/**
 * navi's harness as a library (harness.md): everything between a prompt and
 * an answer, for any front end. The front end brings a model, a directory and
 * a way to ask about shell commands; this brings the prompt, tools, judge,
 * compaction and the step loop. Nothing here prints (HAR-5).
 */

/** A model object, e.g. neorouter's `auto()`; never a gateway id string. */
export type Model = Exclude<LanguageModel, string>

export const DEFAULT_STEPS = 32

/** The parts of `~/.neoai/config.json` the harness reads. */
export interface HarnessConfig {
  /** 'ask' skips the judge and asks about every command (TL-24). */
  approve?: string
  /** false removes web_search (TL-30). */
  web_search?: boolean
  /** false removes only fetch_url (TL-35). */
  fetch_url?: boolean
  /** A search backend asked before DuckDuckGo (TL-44). */
  search?: unknown
  /** false removes write_file and edit_file (TL-40). */
  write?: boolean
  /** Commands that run without the judge or a question (TL-41). */
  allow?: string[]
  /** false removes the browser tools (BRW-13); `{ executable }` is for the front end (BRW-4). */
  browser?: unknown
  /** false keeps no ledger (LED-5). */
  ledger?: boolean
  /** false reads no memory and removes remember (MEM-4). */
  memory?: boolean
}

/** The model a struggling turn is handed to (ESC-1). */
export interface Escalation {
  model: Model
  contextWindow: number
  /** `<backend> · <model id>`, as the ledger and the front end show it. */
  name: string
  /** False when prompts leave the machine. */
  local: boolean
}

export interface HarnessOptions {
  model: Model
  /** Tokens the model holds; compaction keeps history under 70% of it (SES-8). */
  contextWindow: number
  /** Where tools look and shell commands run; named in the system prompt. */
  cwd: string
  /**
   * Asked about each shell command the judge did not call safe, and each
   * file change that is not a new file in `cwd` (HAR-4, TL-38). For a file
   * change, `command` is a one-line summary and `change` holds the diff. The
   * signal aborts when the turn is stopped; a throw, or no answer before
   * then, declines. Leaving it out declines every such request. `'always'`
   * runs a command and adds it to the allowlist (TL-43). For a browser action
   * (BRW-11), `command` is its one-line description and `action` says on
   * which page; it is never remembered. For a fact to remember (MEM-7),
   * `command` is `remember: <fact>` and `memory` is the fact; for a
   * project's (MEM-16), `remember for <project>: <fact>`, and `project` is
   * the project's root.
   */
  approve?: (command: string, o: { signal: AbortSignal; change?: FileChange; action?: { url: string }; memory?: string; project?: string }) => Promise<Answer>
  /**
   * Makes a tab in navi's browser (`makeTab` from `neonavi/browser`), once per
   * session on first use. Left out, there are no browser tools (BRW-13).
   */
  browser?: () => Tab
  /** Read from `~/.neoai/config.json` when left out. */
  config?: HarnessConfig
  /** The front end, for the ledger (HAR-10, LED-1): `cli`, `raycast`, `mcp`, `job`. */
  front?: string
  /** The job these turns are for, kept with what they change (UND-10). */
  job?: string
  /** The model given, as the ledger shows it (LED-1); its own id otherwise. */
  name?: { model: string; local: boolean }
  /**
   * Resolves the model a struggling turn goes on with (ESC-1), the first
   * time one does; null when it does not answer. Left out, nothing escalates.
   */
  escalate?: () => Promise<Escalation | null>
  /** Model responses per turn (CLI-9). */
  maxSteps?: number
  /** Where the NAVI.md walk stops outside a repo (CTX-2), and whose `.neoai` an "always" is saved to; the home directory by default. */
  home?: string
  /** false forces the built-in grep/glob even where rg is installed (TL-31). */
  ripgrep?: boolean
  /**
   * Whether the model's doStream reports tool calls. neorouter's streams only
   * text today, so for it each step is generated whole and replayed as a
   * stream unless the model says `streamsToolCalls: true`.
   */
  streamsToolCalls?: boolean
}

export type HarnessEvent =
  /** The history outgrew the window and its older part was summarised (SES-11). */
  | { type: 'compacted'; messages: number }
  /** Answer text as it arrives. */
  | { type: 'text'; text: string }
  /** A tool call about to run (CLI-10, RAY-2). */
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  /**
   * A shell command the judge passed, or a new file in the working directory,
   * made without asking (TL-22, TL-38). `command` is the change's summary for a file.
   */
  /** `allowed` when the allowlist let it through rather than the judge (TL-42). */
  | { type: 'auto-approved'; command: string; change?: FileChange; allowed?: true }
  /**
   * A command answered "always" (TL-43): allowed from now on, or, with
   * `problem`, for this session only, since the config could not be saved.
   */
  | { type: 'remembered'; command: string; problem?: string }
  /** What the tool returned; `error` when it threw and the model got the message. */
  | { type: 'tool-result'; id: string; name: string; output: unknown; error: boolean }
  /** The model call failed. The turn still ends with `done`. */
  | { type: 'error'; error: unknown }
  /** The turn struggled and goes on on a stronger model (ESC-3); `local` is false when its prompts leave the machine. */
  | { type: 'escalated'; from: string; to: string; local: boolean; reason: string }
  /**
   * Always the last event. `history` is what to store and pass back (HAR-3);
   * `text` is the final step's answer, `empty` when it is blank (CLI-12), and
   * `stopped` when the turn was aborted.
   */
  | { type: 'done'; history: ModelMessage[]; text: string; empty: boolean; stopped: boolean }

export interface Session {
  /** The conversation so far, updated when each turn ends. */
  readonly history: ModelMessage[]
  /**
   * Runs one prompt through the step loop. Aborting the signal, or leaving
   * the loop early, stops the turn and keeps what was said so far. One turn
   * at a time.
   */
  turn: (prompt: string, o?: { signal?: AbortSignal; attachments?: Attachment[] }) => AsyncIterable<HarnessEvent>
}

export interface Harness {
  /** The system prompt every turn is sent with (prompt.md). */
  readonly system: string
  /**
   * A conversation, empty or continued from a stored history (HAR-3); with
   * `answered`, the model whose answer ends that history and when (LED-7).
   */
  session: (history?: ModelMessage[], o?: { answered?: { model: string; at: number } }) => Session
}

export async function createHarness(o: HarnessOptions): Promise<Harness> {
  // Read from where an "always" is saved (TL-43), so the two never differ.
  const config = o.config ?? ((await readConfig(configDir(o.home ?? homedir()))) as HarnessConfig)
  const maxSteps = o.maxSteps ?? DEFAULT_STEPS
  const streamable = (m: Model, told?: boolean) =>
    (told ?? ((m as { streamsToolCalls?: boolean }).streamsToolCalls === true || !m.provider.startsWith('neorouter'))) ? m : generatedAsStream(m)
  const model = streamable(o.model, o.streamsToolCalls)
  const home = o.home ?? homedir()
  const named = o.name ?? { model: o.model.modelId, local: false }
  // Resolved the first time a turn struggles, then kept (ESC-1).
  let escalation: Promise<Escalation | null> | undefined
  // On unless the config says otherwise; off keeps everything but the model on the machine.
  const web = config.web_search !== false
  const fetch = web && config.fetch_url !== false
  const write = config.write !== false
  const browsing = !!o.browser && web && config.browser !== false
  const remembering = config.memory !== false
  const entries = await readdir(o.cwd).catch(() => [])
  const context = await collectContext(o.cwd, o.home ?? homedir())
  const project = remembering ? await projectRoot(o.cwd, home) : undefined
  const system = systemPrompt(o.cwd, entries, context, web, fetch, write, browsing, remembering)
  const systemTokens = estimateTokens([{ role: 'system', content: system }])

  /** The front end's answer, or a decline if it throws or the turn stops first. */
  const askUser = (command: string, signal: AbortSignal, change?: FileChange, action?: { url: string }, memory?: string, project?: string) =>
    new Promise<Answer>((resolve) => {
      if (!o.approve || signal.aborted) return resolve(false)
      // Removed once answered: a long turn would otherwise pile listeners on one signal.
      const settle = (ok: Answer) => {
        signal.removeEventListener('abort', declined)
        resolve(ok)
      }
      const declined = () => settle(false)
      signal.addEventListener('abort', declined, { once: true })
      Promise.resolve()
        .then(() => o.approve!(command, { signal, ...(change && { change }), ...(action && { action }), ...(memory !== undefined && { memory }), ...(project && { project }) }))
        .then((ok) => settle(ok === true || ok === 'always' ? ok : false), declined)
    })

  const session = (start: ModelMessage[] = [], so: { answered?: { model: string; at: number } } = {}): Session => {
    let history = start
    // LED-7: the last answer here, so a prompt correcting it is counted against its model.
    let answered = so.answered
    let busy = false
    let tab: Tab | null = null
    const browser = browsing ? () => (tab ??= o.browser!()) : undefined

    async function* turn(
      prompt: string,
      { signal, attachments }: { signal?: AbortSignal; attachments?: Attachment[] } = {},
    ): AsyncGenerator<HarnessEvent> {
      if (busy) throw new Error('a turn is already running in this session')
      busy = true
      const stop = new AbortController()
      const onAbort = () => stop.abort(signal?.reason)
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
      const events = channel<HarnessEvent>()
      const work = run(prompt, attachments, stop.signal, events.push).then(events.close, events.fail)
      try {
        yield* events
      } finally {
        // Left early: stop the model, and let the turn settle its history first.
        stop.abort()
        await work
        signal?.removeEventListener('abort', onAbort)
        busy = false
      }
    }

    async function run(prompt: string, attachments: Attachment[] | undefined, signal: AbortSignal, emit: (e: HarnessEvent) => void) {
      const started = Date.now()
      let declined = 0
      const ask = (command: string, signal: AbortSignal, change?: FileChange, action?: { url: string }, memory?: string, project?: string) =>
        askUser(command, signal, change, action, memory, project).then((ok) => {
          if (ok === false && !signal.aborted) declined++
          return ok
        })
      const packed = await compact(o.model, history, { contextWindow: o.contextWindow, extraTokens: systemTokens })
      if (packed.compacted) emit({ type: 'compacted', messages: packed.compacted })
      // UND-7: what the user undid since, said before what they ask now.
      const undone = await takeNote(home, o.cwd).catch(() => undefined)
      const sent: ModelMessage[] = [...packed.messages, { role: 'user', content: userContent(undone ? `${undone}\n\n${prompt}` : prompt, attachments) }]
      const recorder = makeRecorder(home, o.cwd, prompt, undefined, o.job)

      // A tool runs as soon as its call is parsed, which can be before the
      // call's own event is out; what is said about it waits for that event,
      // so a front end shows the call first. Not forever: a call that never
      // gets an event must still be answered.
      const shown = new Map<string, () => void>()
      const shownCalls = new Set<string>()
      const after = (id?: string) =>
        !id || shownCalls.has(id)
          ? Promise.resolve()
          : Promise.race([new Promise<void>((r) => shown.set(id, r)), new Promise<void>((r) => setTimeout(r, 1000).unref?.())])

      const approve = async (command: string, toolSignal?: AbortSignal, id?: string) => {
        await after(id)
        const ok = await gated({
          // The judge reads the command in the light of what was asked (TL-18).
          judge: (c) => judge(o.model, c, prompt),
          mode: config.approve,
          allow: () => config.allow,
          // Kept for this session at once, and in the config file for the next.
          remember: async (c) => {
            config.allow = [...(Array.isArray(config.allow) ? config.allow : []), c.trim()]
            const saved = await allowCommand(c, configDir(o.home ?? homedir())).then(
              () => undefined,
              (e) => (e instanceof Error ? e.message : String(e)),
            )
            emit({ type: 'remembered', command: c, ...(saved && { problem: saved }) })
          },
          onAuto: (c, how) => emit({ type: 'auto-approved', command: c, ...(how === 'allowed' && { allowed: true }) }),
          ask: (c) => ask(c, toolSignal ?? signal),
        })(command)
        // UND-6: run, so undo can say it is not undone.
        if (ok) recorder.ran(command)
        return ok
      }
      // A new file in the working directory is what the judge would call safe
      // (TL-21), so it needs no model call to decide; any other change asks (TL-38).
      const change = async ({ inside, ...c }: FileChange & { inside: boolean }, toolSignal?: AbortSignal, id?: string) => {
        await after(id)
        if (config.approve !== 'ask' && c.created && inside) {
          emit({ type: 'auto-approved', command: summarize(c), change: c })
          return true
        }
        // Never kept: "always" is for commands, so here it is a plain yes.
        return (await ask(summarize(c), toolSignal ?? signal, c)) !== false
      }
      // Judged as shell commands are (BRW-11), but never remembered: "always" is a plain yes.
      const act = async ({ line, url }: { line: string; url: string }, toolSignal?: AbortSignal, id?: string) => {
        await after(id)
        if (config.approve !== 'ask' && (await judge(o.model, line, prompt, { url })) === 'safe') {
          emit({ type: 'auto-approved', command: line })
          return true
        }
        return (await ask(line, toolSignal ?? signal, undefined, { url })) !== false
      }
      // Always asked, whatever the mode or judge (MEM-7): a fact is sent with every later turn.
      const remember = async (fact: string, toolSignal?: AbortSignal, id?: string, where?: string) => {
        await after(id)
        const what = where ? `remember for ${basename(where)}: ${fact}` : `remember: ${fact}`
        return (await ask(what, toolSignal ?? signal, undefined, undefined, fact, where)) !== false
      }
      const tools = makeTools(
        { approve, change, act, remember },
        {
          web, fetch, write, cwd: o.cwd, ripgrep: o.ripgrep, search: searchBackend(config.search), browser,
          ...(remembering && { memory: home, ...(project && { project }) }),
          wrote: recorder.wrote,
        },
      )

      const tally: Record<string, number> = {}
      let steps = 0
      let toolErrors = 0
      let failed = false

      /**
       * One model's go at the turn. With `struggle` set, a failing model call,
       * three failing tool calls in a row, or a step budget spent still
       * calling tools ends it early with why (ESC-2), rather than as an error.
       */
      // Somewhere to go: the escalation model resolved, and is not this one.
      const target = async () => {
        if (!o.escalate) return null
        const to = await (escalation ??= o.escalate().catch(() => null))
        return to && to.name !== named.model ? to : null
      }

      const attempt = async (m: Model, messages: ModelMessage[], struggle: boolean) => {
        const own = new AbortController()
        const onStop = () => own.abort()
        if (signal.aborted) own.abort()
        else signal.addEventListener('abort', onStop, { once: true })
        // Messages of the finished steps; the step in flight only adds its text.
        let finished: ModelMessage[] = []
        let lastText = ''
        let partial = ''
        let stopped = signal.aborted
        let trouble: string | undefined
        let inARow = 0
        let lastCalledTools = false
        let taken = 0
        if (!stopped) {
          try {
            const result = streamText({
              model: m,
              // PRM-13: the day, as of this turn.
              // MEM-2: memory as of this turn, too.
              system: `${system}${remembering ? memorySection(await readMemory(home), project ? { root: project, facts: await readMemory(home, project) } : undefined) : ''}\n${today()}`,
              tools,
              messages,
              stopWhen: stepCountIs(maxSteps),
              abortSignal: own.signal,
              // The default logs to the console; errors are events here (HAR-5).
              onError: () => {},
              onStepFinish: (step) => {
                finished = step.response.messages
                lastText = step.text
                lastCalledTools = step.toolCalls.length > 0
                taken++
              },
            })
            for await (const part of result.fullStream) {
              switch (part.type) {
                case 'start-step':
                case 'finish-step':
                  partial = ''
                  break
                case 'text-delta':
                  partial += part.text
                  emit({ type: 'text', text: part.text })
                  break
                case 'tool-call':
                  tally[part.toolName] = (tally[part.toolName] ?? 0) + 1
                  emit({ type: 'tool-call', id: part.toolCallId, name: part.toolName, input: part.input })
                  shownCalls.add(part.toolCallId)
                  shown.get(part.toolCallId)?.()
                  break
                case 'tool-result':
                  if (!part.preliminary) {
                    inARow = 0
                    emit({ type: 'tool-result', id: part.toolCallId, name: part.toolName, output: part.output, error: false })
                  }
                  break
                case 'tool-error':
                  toolErrors++
                  emit({ type: 'tool-result', id: part.toolCallId, name: part.toolName, output: message(part.error), error: true })
                  if (struggle && ++inARow >= 3 && !trouble && (await target())) {
                    trouble = 'three tool calls in a row failed'
                    own.abort()
                  }
                  break
                case 'error':
                  if (struggle && !trouble && (await target())) {
                    trouble = `the model call failed (${message(part.error)})`
                    own.abort()
                  } else if (!trouble) {
                    failed = true
                    emit({ type: 'error', error: part.error })
                  }
                  break
                case 'abort':
                  if (!trouble) stopped = true
                  break
              }
            }
          } catch (error) {
            if (signal.aborted) stopped = true
            else if (struggle && !trouble && (await target())) trouble = `the model call failed (${message(error)})`
            else if (!trouble) {
              failed = true
              emit({ type: 'error', error })
            }
          }
        }
        signal.removeEventListener('abort', onStop)
        steps += taken
        // A step cut short keeps its words but not its tool calls: a call without
        // its result is rejected by every backend on the next turn.
        const kept: ModelMessage[] = partial && !trouble ? [{ role: 'assistant', content: partial }] : []
        const text = trouble ? '' : partial || lastText
        if (struggle && !trouble && !stopped && !failed && (await target())) {
          if (taken >= maxSteps && lastCalledTools) trouble = `it used all ${maxSteps} steps still calling tools`
          else if (!text.trim()) trouble = 'it gave no answer'
        }
        return { messages: [...finished, ...kept], text, stopped, trouble }
      }

      // Escalation is only tried where there is somewhere to go (ESC-3).
      const first = await attempt(model, sent, !!o.escalate)
      let done = first
      let whole = [...sent, ...first.messages]
      let escalated: { from: string; reason: string } | undefined
      let answering = named
      const to = first.trouble && !first.stopped ? await target() : null
      if (to && first.trouble) {
        escalated = { from: named.model, reason: first.trouble }
        answering = { model: to.name, local: to.local }
        emit({ type: 'escalated', from: named.model, to: to.name, local: to.local, reason: first.trouble })
        // What the first model did stays, with a word on why another goes on (ESC-3).
        const note: ModelMessage = {
          role: 'user',
          content: `(navi: the model that started on this struggled: ${first.trouble}. Carry on from where it got to and finish the task above.)`,
        }
        done = await attempt(streamable(to.model), [...whole, note], false)
        whole = [...whole, note, ...done.messages]
      }
      history = whole
      const text = done.text
      const stopped = done.stopped
      // Written before the turn is said to be done: a front end may exit on `done`.
      // Kept for front ends that name themselves (HAR-10), so a library's own tests leave none.
      if (o.front && config.ledger !== false) {
        const entry: LedgerEntry = {
          at: new Date().toISOString(),
          front: o.front,
          model: answering.model,
          local: answering.local,
          ms: Date.now() - started,
          steps,
          tools: tally,
          toolErrors,
          declined,
          promptChars: prompt.length,
          attachments: attachments?.length ?? 0,
          outcome: stopped ? 'stopped' : text.trim() ? 'answered' : failed ? 'error' : 'empty',
          ...(escalated && { escalated }),
          ...(answered && Date.now() - answered.at < CORRECTION_WINDOW && readsAsCorrection(prompt) && { corrects: answered.model }),
        }
        await record(home, entry)
      }
      answered = !stopped && text.trim() ? { model: answering.model, at: Date.now() } : undefined
      // On disk before done, so an undo straight after finds it.
      await recorder.saved()
      emit({ type: 'done', history, text, empty: !text.trim(), stopped })
    }

    return {
      get history() {
        return history
      },
      turn,
    }
  }

  return { system, session }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type StreamPart = Awaited<ReturnType<Model['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never

/**
 * A model whose stream is one generate call replayed: slower to show text,
 * but tool calls arrive, which a text-only stream would silently drop.
 */
export function generatedAsStream(inner: Model): Model {
  return {
    specificationVersion: 'v2',
    get provider() {
      return inner.provider
    },
    get modelId() {
      return inner.modelId
    },
    get supportedUrls() {
      return inner.supportedUrls
    },
    doGenerate: (options) => inner.doGenerate(options),
    doStream: async (options) => {
      const r = await inner.doGenerate(options)
      const parts: StreamPart[] = [
        { type: 'stream-start', warnings: r.warnings },
        { type: 'response-metadata', id: r.response?.id, timestamp: r.response?.timestamp, modelId: r.response?.modelId },
      ]
      for (const [i, c] of r.content.entries()) {
        const id = `${c.type}-${i}`
        if (c.type === 'text') parts.push({ type: 'text-start', id }, { type: 'text-delta', id, delta: c.text }, { type: 'text-end', id })
        else if (c.type === 'reasoning')
          parts.push({ type: 'reasoning-start', id }, { type: 'reasoning-delta', id, delta: c.text }, { type: 'reasoning-end', id })
        else parts.push(c)
      }
      parts.push({ type: 'finish', finishReason: r.finishReason, usage: r.usage, providerMetadata: r.providerMetadata })
      const stream = new ReadableStream<StreamPart>({
        start(controller) {
          for (const p of parts) controller.enqueue(p)
          controller.close()
        },
      })
      return { stream, request: r.request, response: { headers: r.response?.headers } }
    },
  }
}

/** Events pushed from callbacks and the stream alike, read in order by the front end. */
function channel<T>() {
  const items: T[] = []
  let wake: (() => void) | null = null
  let done = false
  let failure: { error: unknown } | null = null
  const poke = () => {
    wake?.()
    wake = null
  }
  return {
    push: (item: T) => {
      items.push(item)
      poke()
    },
    close: () => {
      done = true
      poke()
    },
    fail: (error: unknown) => {
      failure = { error }
      done = true
      poke()
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length) yield items.shift()!
        else if (failure) throw failure.error
        else if (done) return
        else await new Promise<void>((r) => (wake = r))
      }
    },
  }
}
