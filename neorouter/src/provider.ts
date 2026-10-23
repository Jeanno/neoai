import type {
  LanguageModelV2,
  LanguageModelV2Content,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'
import type { Resolved } from './resolve.ts'
import { diagnoseBackend, probeBackend, resolveBackend, type Scope } from './resolve.ts'
import { shutdown } from './launch.ts'
import { serialize } from './hosted.ts'
import type { Prefer, Server } from './types.ts'

function chatEndpoint(server: Server, backend: string): string {
  if (server.native === 'ollama') return `${server.baseURL}/v1/chat/completions`
  if (backend === 'pollinations') return server.baseURL
  return `${server.baseURL}/chat/completions`
}

interface OaiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OaiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

interface OaiMessage {
  role: string
  content: string | OaiPart[]
  tool_calls?: OaiToolCall[]
  tool_call_id?: string
}

/** An image as a URL a chat API takes: a link stays a link, bytes become a data URL. */
function imageURL(data: URL | Uint8Array | string, mediaType: string): string {
  if (data instanceof URL) return data.href
  if (typeof data === 'string') return /^(https?|data):/.test(data) ? data : `data:${mediaType};base64,${data}`
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`
}

export function toMessages(prompt: LanguageModelV2CallOptions['prompt']): {
  messages: OaiMessage[]
  warnings: LanguageModelV2CallWarning[]
} {
  const warnings: LanguageModelV2CallWarning[] = []
  const messages: OaiMessage[] = []

  for (const m of prompt) {
    if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content })
      continue
    }
    if (m.role === 'tool') {
      for (const p of m.content)
        messages.push({ role: 'tool', tool_call_id: p.toolCallId, content: outputText(p.output) })
      continue
    }
    const calls: OaiToolCall[] = []
    // A user image goes as an OpenAI image part, so a vision model sees it.
    const images: OaiPart[] = []
    const text = m.content
      .map((p) => {
        if (p.type === 'text') return p.text
        if (p.type === 'file' && m.role === 'user' && p.mediaType.startsWith('image/')) {
          images.push({ type: 'image_url', image_url: { url: imageURL(p.data, p.mediaType) } })
          return ''
        }
        if (p.type === 'tool-call') {
          calls.push({
            id: p.toolCallId,
            type: 'function',
            function: {
              name: p.toolName,
              arguments: typeof p.input === 'string' ? p.input : JSON.stringify(p.input ?? {}),
            },
          })
          return ''
        }
        warnings.push({ type: 'other', message: `dropped unsupported ${p.type} part` })
        return ''
      })
      .join('')
    // An assistant turn that only called a tool still has to appear in history,
    // or the tool result that follows refers to a call the model never made.
    if (calls.length) messages.push({ role: m.role, content: text, tool_calls: calls })
    else if (images.length) messages.push({ role: m.role, content: [...(text ? [{ type: 'text' as const, text }] : []), ...images] })
    else if (text) messages.push({ role: m.role, content: text })
  }
  return { messages, warnings }
}

/**
 * The AI SDK does not prompt-engineer JSON on the provider's behalf — it sends
 * responseFormat and expects the backend to constrain decoding. Every
 * OpenAI-shaped server we talk to takes response_format, so pass it through:
 * with a schema the output cannot be malformed, which beats parse-and-retry.
 */
function responseFormat(o: LanguageModelV2CallOptions) {
  if (o.responseFormat?.type !== 'json') return undefined
  const { schema, name } = o.responseFormat
  if (!schema) return { type: 'json_object' as const }
  return {
    type: 'json_schema' as const,
    json_schema: { name: name ?? 'response', strict: true, schema },
  }
}

/** The AI SDK's tool-result output is a tagged union; the wire wants a string. */
function outputText(output: any): string {
  if (output == null) return ''
  if (output.type === 'text' || output.type === 'error-text') return String(output.value)
  return JSON.stringify(output.value ?? output)
}

export function toolsPayload(tools: readonly any[]): unknown[] {
  return tools
    .filter((t) => t.type === 'function')
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description && { description: t.description }),
        parameters: t.inputSchema,
      },
    }))
}

export function fromChoice(choice: any): LanguageModelV2Content[] {
  const calls = choice?.message?.tool_calls ?? []
  if (calls.length)
    return calls.map((c: any) => ({
      type: 'tool-call' as const,
      toolCallId: c.id,
      toolName: c.function?.name,
      // Raw JSON text, not parsed: the SDK validates it against the tool schema.
      input: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}),
    }))
  return [{ type: 'text' as const, text: choice?.message?.content ?? '' }]
}

/**
 * Measured on ollama 0.32.15 / qwen3.5:2b: a reasoning model spends ~120 tokens
 * of thinking per token of answer, and in an agent loop it will exhaust its
 * budget mid-thought and return nothing at all. 'none' is the only knob that
 * works here — `think: false` is silently ignored on the OpenAI-shaped endpoint.
 * Ollama and custom endpoints are asked: a custom endpoint is usually a
 * self-hosted open model (Darkbloom serving Qwen thinks ~15s per answer
 * otherwise). One that rejects the field is retried without it (see send).
 */
export function reasoningEffort(server: Server, think: boolean | undefined): 'none' | undefined {
  if (think !== false) return undefined
  return server.native === 'ollama' || server.custom ? 'none' : undefined
}

function body(o: LanguageModelV2CallOptions, r: Resolved, stream: boolean, think?: boolean) {
  const { messages, warnings } = toMessages(o.prompt)
  const tools = o.tools?.length ? toolsPayload(o.tools) : undefined
  return {
    warnings,
    payload: {
      model: r.modelId,
      messages,
      stream,
      ...(o.maxOutputTokens != null && { max_tokens: o.maxOutputTokens }),
      ...(o.temperature != null && { temperature: o.temperature }),
      ...(o.topP != null && { top_p: o.topP }),
      ...(o.stopSequences?.length && { stop: o.stopSequences }),
      ...(tools?.length && { tools }),
      ...(o.toolChoice?.type === 'required' && { tool_choice: 'required' }),
      ...(reasoningEffort(r.server, think) && { reasoning_effort: reasoningEffort(r.server, think) }),
      ...(responseFormat(o) && { response_format: responseFormat(o) }),
      // Pollinations asks callers to identify themselves; harmless elsewhere.
      ...(r.backend === 'pollinations' && { referrer: 'neorouter' }),
    },
  }
}

function metadata(r: Resolved) {
  return {
    neorouter: {
      backend: r.backend,
      rung: r.rung,
      local: r.local,
      contextWindow: r.contextWindow,
      reason: r.reason,
      rejected: r.rejected,
      ...(r.pid != null && { pid: r.pid }),
      ...(r.coldStartMs != null && { coldStartMs: r.coldStartMs }),
    },
  } as any
}

const FINISH: Record<string, LanguageModelV2FinishReason> = {
  stop: 'stop',
  length: 'length',
  content_filter: 'content-filter',
  tool_calls: 'tool-calls',
}

/** Keyless endpoints return 402/429/5xx unpredictably under load. */
const TRANSIENT = new Set([402, 408, 409, 425, 429, 500, 502, 503, 504])

/**
 * Aborts only while waiting for response headers, then disarms — so a slow
 * generation streams for as long as it likes, but an endpoint that accepts the
 * connection and never answers cannot hang the caller forever. Local servers get
 * no deadline: a cold model load legitimately takes over a minute. The caller's
 * own signal (the AI SDK's abortSignal) stays armed for the whole body, so
 * giving up on an answer also stops the backend generating it.
 */
async function fetchWithHeaderDeadline(
  url: string,
  payload: unknown,
  ms: number | null,
  auth?: string,
  caller?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = ms == null ? null : setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth && { authorization: `Bearer ${auth}` }),
      },
      body: JSON.stringify(payload),
      signal: caller ? AbortSignal.any([ctrl.signal, caller]) : ctrl.signal,
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const HOSTED_HEADER_TIMEOUT_MS = 30_000

async function send(
  url: string,
  payload: unknown,
  hosted: boolean,
  auth?: string,
  caller?: AbortSignal,
  attempt = 0,
): Promise<Response> {
  if (process.env.NEOROUTER_DEBUG) console.error('POST', url, JSON.stringify(payload))
  let res: Response
  try {
    res = await fetchWithHeaderDeadline(url, payload, hosted ? HOSTED_HEADER_TIMEOUT_MS : null, auth, caller)
  } catch (e) {
    // Cancelled by the caller: retrying would only start the answer they abandoned.
    if (caller?.aborted) throw e
    if (hosted && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
      return send(url, payload, hosted, auth, caller, attempt + 1)
    }
    throw new Error(`neorouter: ${url} did not respond (${String(e)})`)
  }
  if (res.ok) return res
  if (TRANSIENT.has(res.status) && attempt < 3) {
    // Seconds, not milliseconds: a fast retry re-enters a queue we just filled.
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
    return send(url, payload, hosted, auth, caller, attempt + 1)
  }
  const text = await res.text()
  // A strict server may refuse a field it does not know; reasoning_effort is
  // only ever a hint, so ask once more without it.
  const p = payload as { reasoning_effort?: string }
  if (res.status === 400 && p?.reasoning_effort && /reasoning/i.test(text)) {
    const { reasoning_effort: _, ...rest } = p
    return send(url, rest, hosted, auth, caller, attempt)
  }
  throw new Error(`neorouter: ${url} responded ${res.status} ${text}`)
}

/**
 * Only the anonymous tier needs pacing. OpenRouter is authenticated and takes
 * concurrent requests, so serialising it would cost 3s a call for nothing.
 */
function post(url: string, payload: unknown, r: Resolved, caller?: AbortSignal): Promise<Response> {
  // A custom endpoint on this computer is still often a busy shared server (MOD-20).
  const hosted = !r.local || !!r.server.custom
  const auth = r.server.auth
  const paced = hosted && r.backend === 'pollinations'
  return paced
    ? serialize(() => send(url, payload, true, auth, caller))
    : send(url, payload, hosted, auth, caller)
}

class AutoModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const
  readonly supportedUrls = {}
  /** Read by navi's harness: tool calls arrive in the stream, so it need not fake one. */
  readonly streamsToolCalls = true
  private resolution: Resolved | null = null

  constructor(
    private readonly prefer?: Prefer,
    private readonly think?: boolean,
    private readonly remote?: boolean,
    private readonly pinned?: string,
    private readonly scope?: Scope,
    private readonly target?: string,
  ) {}

  get provider() {
    return this.resolution ? `neorouter:${this.resolution.backend}` : 'neorouter'
  }

  get modelId() {
    return this.resolution?.modelId ?? 'auto'
  }

  private async ready(): Promise<Resolved> {
    return (this.resolution ??= await resolveBackend(this.prefer, this.remote, this.pinned, this.scope, this.target))
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const r = await this.ready()
    const { payload, warnings } = body(options, r, false, this.think)
    const res = await post(chatEndpoint(r.server, r.backend), payload, r, options.abortSignal)
    const json = (await res.json()) as any
    const choice = json.choices?.[0]
    return {
      content: fromChoice(choice),
      finishReason: FINISH[choice?.finish_reason] ?? 'unknown',
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      },
      providerMetadata: metadata(r),
      response: { id: json.id, modelId: json.model ?? r.modelId },
      warnings,
    }
  }

  private async simulateStream(options: LanguageModelV2CallOptions) {
    const generated = await this.doGenerate(options)
    const text = generated.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    const id = 'txt-0'
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: generated.warnings })
        controller.enqueue({ type: 'response-metadata', modelId: generated.response?.modelId })
        controller.enqueue({ type: 'text-start', id })
        for (const chunk of text.match(/\s*\S+/g) ?? [])
          controller.enqueue({ type: 'text-delta', id, delta: chunk })
        controller.enqueue({ type: 'text-end', id })
        controller.enqueue({
          type: 'finish',
          finishReason: generated.finishReason,
          usage: generated.usage,
          providerMetadata: generated.providerMetadata,
        })
        controller.close()
      },
    })
    return { stream }
  }

  async doStream(options: LanguageModelV2CallOptions) {
    const r = await this.ready()
    // The keyless tier accepts `stream: true` and then never sends headers, so
    // on that rung we generate once and emit the result as deltas. Callers get
    // a working stream instead of a hang; only the token-by-token pacing is lost.
    // Only the keyless tier accepts `stream: true` and then never sends headers;
    // an authenticated backend streams properly and should not be faked.
    if (r.backend === 'pollinations') return this.simulateStream(options)
    const { payload, warnings } = body(options, r, true, this.think)
    const res = await post(chatEndpoint(r.server, r.backend), payload, r, options.abortSignal)
    const parts = sseParts(res.body as AsyncIterable<Uint8Array>, metadata(r))
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings })
        controller.enqueue({ type: 'response-metadata', modelId: r.modelId })
        for await (const part of parts) controller.enqueue(part)
        controller.close()
      },
    })

    return { stream }
  }
}

/**
 * An OpenAI-style server-sent event stream as AI SDK stream parts: text as it
 * arrives, then any tool calls, then the finish.
 */
export async function* sseParts(
  body: AsyncIterable<Uint8Array>,
  providerMetadata?: ReturnType<typeof metadata>,
): AsyncGenerator<LanguageModelV2StreamPart> {
  const id = 'txt-0'
  yield { type: 'text-start', id }
  let finishReason: LanguageModelV2FinishReason = 'stop'
  let usage: LanguageModelV2Usage = {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
  }
  let buffer = ''
  // Tool calls arrive as fragments keyed by index: the id and name once, the
  // JSON arguments in pieces. They are only complete at the end.
  const calls = new Map<number, { id: string; name: string; args: string }>()
  for await (const chunk of body) {
    buffer += Buffer.from(chunk).toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      const choice = json.choices?.[0]
      const delta = choice?.delta?.content
      if (delta) yield { type: 'text-delta', id, delta }
      for (const t of choice?.delta?.tool_calls ?? []) {
        const call = calls.get(t.index ?? 0) ?? { id: '', name: '', args: '' }
        if (t.id) call.id = t.id
        if (t.function?.name) call.name += t.function.name
        if (t.function?.arguments) call.args += t.function.arguments
        calls.set(t.index ?? 0, call)
      }
      if (choice?.finish_reason) finishReason = FINISH[choice.finish_reason] ?? 'unknown'
      if (json.usage)
        usage = {
          inputTokens: json.usage.prompt_tokens,
          outputTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
    }
  }
  yield { type: 'text-end', id }
  for (const [i, c] of calls)
    yield { type: 'tool-call', toolCallId: c.id || `call-${i}`, toolName: c.name, input: c.args || '{}' }
  // Some servers end a tool-calling turn with 'stop'; the SDK only runs tools on 'tool-calls'.
  if (calls.size) finishReason = 'tool-calls'
  yield { type: 'finish', finishReason, usage, providerMetadata }
}

export interface AutoOptions {
  /** 'fast' picks the smallest usable model instead of the largest that fits. */
  prefer?: Prefer
  /** false asks a reasoning model to skip thinking. Left alone by default. */
  think?: boolean
  /** true tries the hosted rung before the local ones, still falling back. */
  remote?: boolean
  /** Pin an exact model id instead of letting neorouter rank. */
  model?: string
  /** Restrict resolution to one class of backend, for chain callers. */
  scope?: Scope
  /**
   * A provider id or custom endpoint name: resolve to that server and nothing
   * else. With `model`, that model must be in its list.
   */
  provider?: string
}

export function auto(options: AutoOptions = {}): LanguageModelV2 {
  return new AutoModel(options.prefer, options.think, options.remote, options.model, options.scope, options.provider)
}

/**
 * What auto(options) resolves to, or null when it cannot — without making a
 * call. Memoised with it, so the model then built costs no second lookup.
 */
export function probe(options: AutoOptions = {}) {
  return probeBackend(options.prefer, options.remote, options.model, options.scope, options.provider)
}

/** Where a chat request for auto(options) goes, for a caller that sends it itself. */
export interface Route {
  url: string
  /** Carries the key when the backend needs one. Never log these. */
  headers: Record<string, string>
  /** The model id the backend knows. */
  model: string
  backend: string
  local: boolean
  /** Fields neorouter would add to the body itself, such as reasoning_effort. */
  extra: Record<string, unknown>
}

/** The chat endpoint auto(options) would call, or null when it resolves to nothing. */
export async function route(options: AutoOptions = {}): Promise<Route | null> {
  const r = await probe(options)
  if (!r) return null
  const effort = reasoningEffort(r.server, options.think)
  return {
    url: chatEndpoint(r.server, r.backend),
    headers: { 'content-type': 'application/json', ...(r.server.auth && { authorization: `Bearer ${r.server.auth}` }) },
    model: r.modelId,
    backend: r.backend,
    local: r.local,
    extra: effort ? { reasoning_effort: effort } : {},
  }
}

/** Why probe(options) is null, or null when it resolves (MOD-21). */
export function diagnose(options: AutoOptions = {}) {
  return diagnoseBackend(options.prefer, options.remote, options.model, options.scope, options.provider)
}

auto.shutdown = shutdown
