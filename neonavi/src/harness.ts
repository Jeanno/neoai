import { stepCountIs, streamText, type LanguageModel, type ModelMessage } from 'ai'
import { readConfig } from 'neorouter'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { systemPrompt } from './args.ts'
import { collectContext } from './context.ts'
import { gated } from './approve.ts'
import { judge } from './judge.ts'
import { makeTools } from './tools.ts'
import { compact, estimateTokens } from './compact.ts'

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
}

export interface HarnessOptions {
  model: Model
  /** Tokens the model holds; compaction keeps history under 70% of it (SES-8). */
  contextWindow: number
  /** Where tools look and shell commands run; named in the system prompt. */
  cwd: string
  /**
   * Asked about each shell command the judge did not call safe (HAR-4). The
   * signal aborts when the turn is stopped; a throw, or no answer before
   * then, declines. Leaving it out declines every such command.
   */
  approve?: (command: string, o: { signal: AbortSignal }) => Promise<boolean>
  /** Read from `~/.neoai/config.json` when left out. */
  config?: HarnessConfig
  /** Model responses per turn (CLI-9). */
  maxSteps?: number
  /** Where the NAVI.md walk stops outside a repo (CTX-2); the home directory by default. */
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
  /** A shell command the judge passed, so it runs without asking (TL-22). */
  | { type: 'auto-approved'; command: string }
  /** What the tool returned; `error` when it threw and the model got the message. */
  | { type: 'tool-result'; id: string; name: string; output: unknown; error: boolean }
  /** The model call failed. The turn still ends with `done`. */
  | { type: 'error'; error: unknown }
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
  turn: (prompt: string, o?: { signal?: AbortSignal }) => AsyncIterable<HarnessEvent>
}

export interface Harness {
  /** The system prompt every turn is sent with (prompt.md). */
  readonly system: string
  /** A conversation, empty or continued from a stored history (HAR-3). */
  session: (history?: ModelMessage[]) => Session
}

export async function createHarness(o: HarnessOptions): Promise<Harness> {
  const config = o.config ?? ((await readConfig()) as HarnessConfig)
  const maxSteps = o.maxSteps ?? DEFAULT_STEPS
  const native = o.streamsToolCalls ?? ((o.model as { streamsToolCalls?: boolean }).streamsToolCalls === true || !o.model.provider.startsWith('neorouter'))
  const model = native ? o.model : generatedAsStream(o.model)
  // On unless the config says otherwise; off keeps everything but the model on the machine.
  const web = config.web_search !== false
  const entries = await readdir(o.cwd).catch(() => [])
  const context = await collectContext(o.cwd, o.home ?? homedir())
  const system = systemPrompt(o.cwd, entries, context, web)
  const systemTokens = estimateTokens([{ role: 'system', content: system }])

  /** The front end's answer, or a decline if it throws or the turn stops first. */
  const ask = (command: string, signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      if (!o.approve || signal.aborted) return resolve(false)
      // Removed once answered: a long turn would otherwise pile listeners on one signal.
      const settle = (ok: boolean) => {
        signal.removeEventListener('abort', declined)
        resolve(ok)
      }
      const declined = () => settle(false)
      signal.addEventListener('abort', declined, { once: true })
      Promise.resolve()
        .then(() => o.approve!(command, { signal }))
        .then((ok) => settle(ok === true), declined)
    })

  const session = (start: ModelMessage[] = []): Session => {
    let history = start
    let busy = false

    async function* turn(prompt: string, { signal }: { signal?: AbortSignal } = {}): AsyncGenerator<HarnessEvent> {
      if (busy) throw new Error('a turn is already running in this session')
      busy = true
      const stop = new AbortController()
      const onAbort = () => stop.abort(signal?.reason)
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
      const events = channel<HarnessEvent>()
      const work = run(prompt, stop.signal, events.push).then(events.close, events.fail)
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

    async function run(prompt: string, signal: AbortSignal, emit: (e: HarnessEvent) => void) {
      const packed = await compact(o.model, history, { contextWindow: o.contextWindow, extraTokens: systemTokens })
      if (packed.compacted) emit({ type: 'compacted', messages: packed.compacted })
      const sent: ModelMessage[] = [...packed.messages, { role: 'user', content: prompt }]

      const approve = (command: string, toolSignal?: AbortSignal) =>
        gated({
          // The judge reads the command in the light of what was asked (TL-18).
          judge: (c) => judge(o.model, c, prompt),
          mode: config.approve,
          onAuto: (c) => emit({ type: 'auto-approved', command: c }),
          ask: (c) => ask(c, toolSignal ?? signal),
        })(command)
      const tools = makeTools({ approve }, { web, cwd: o.cwd, ripgrep: o.ripgrep })

      // Messages of the finished steps; the step in flight only adds its text.
      let finished: ModelMessage[] = []
      let lastText = ''
      let partial = ''
      let stopped = signal.aborted
      if (!stopped) {
        try {
          const result = streamText({
            model,
            system,
            tools,
            messages: sent,
            stopWhen: stepCountIs(maxSteps),
            abortSignal: signal,
            // The default logs to the console; errors are events here (HAR-5).
            onError: () => {},
            onStepFinish: (step) => {
              finished = step.response.messages
              lastText = step.text
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
                emit({ type: 'tool-call', id: part.toolCallId, name: part.toolName, input: part.input })
                break
              case 'tool-result':
                if (!part.preliminary)
                  emit({ type: 'tool-result', id: part.toolCallId, name: part.toolName, output: part.output, error: false })
                break
              case 'tool-error':
                emit({ type: 'tool-result', id: part.toolCallId, name: part.toolName, output: message(part.error), error: true })
                break
              case 'error':
                emit({ type: 'error', error: part.error })
                break
              case 'abort':
                stopped = true
                break
            }
          }
        } catch (error) {
          if (signal.aborted) stopped = true
          else emit({ type: 'error', error })
        }
      }
      // A step cut short keeps its words but not its tool calls: a call without
      // its result is rejected by every backend on the next turn.
      const kept: ModelMessage[] = partial ? [{ role: 'assistant', content: partial }] : []
      history = [...sent, ...finished, ...kept]
      const text = partial || lastText
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
