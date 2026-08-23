import type {
  LanguageModelV2,
  LanguageModelV2Content,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'
import type { Resolved } from './resolve.ts'
import { resolveBackend } from './resolve.ts'
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

interface OaiMessage {
  role: string
  content: string
  tool_calls?: OaiToolCall[]
  tool_call_id?: string
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
    const text = m.content
      .map((p) => {
        if (p.type === 'text') return p.text
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
 * Only ollama is measured, so only ollama is asked.
 */
export function reasoningEffort(server: Server, think: boolean | undefined): 'none' | undefined {
  return server.native === 'ollama' && think === false ? 'none' : undefined
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
 * no deadline: a cold model load legitimately takes over a minute.
 */
async function fetchWithHeaderDeadline(
  url: string,
  payload: unknown,
  ms: number | null,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = ms == null ? null : setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
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
  attempt = 0,
): Promise<Response> {
  if (process.env.NEOROUTER_DEBUG) console.error('POST', url, JSON.stringify(payload))
  let res: Response
  try {
    res = await fetchWithHeaderDeadline(url, payload, hosted ? HOSTED_HEADER_TIMEOUT_MS : null)
  } catch (e) {
    if (hosted && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
      return send(url, payload, hosted, attempt + 1)
    }
    throw new Error(`neorouter: ${url} did not respond (${String(e)})`)
  }
  if (res.ok) return res
  if (TRANSIENT.has(res.status) && attempt < 3) {
    // Seconds, not milliseconds: a fast retry re-enters a queue we just filled.
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
    return send(url, payload, hosted, attempt + 1)
  }
  throw new Error(`neorouter: ${url} responded ${res.status} ${await res.text()}`)
}

function post(url: string, payload: unknown, hosted: boolean): Promise<Response> {
  return hosted ? serialize(() => send(url, payload, true)) : send(url, payload, false)
}

class AutoModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const
  readonly supportedUrls = {}
  private resolution: Resolved | null = null

  constructor(
    private readonly prefer?: Prefer,
    private readonly think?: boolean,
  ) {}

  get provider() {
    return this.resolution ? `neorouter:${this.resolution.backend}` : 'neorouter'
  }

  get modelId() {
    return this.resolution?.modelId ?? 'auto'
  }

  private async ready(): Promise<Resolved> {
    return (this.resolution ??= await resolveBackend(this.prefer))
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const r = await this.ready()
    const { payload, warnings } = body(options, r, false, this.think)
    const res = await post(chatEndpoint(r.server, r.backend), payload, !r.local)
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
    if (!r.local) return this.simulateStream(options)
    const { payload, warnings } = body(options, r, true, this.think)
    const res = await post(chatEndpoint(r.server, r.backend), payload, !r.local)
    const id = 'txt-0'

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings })
        controller.enqueue({ type: 'response-metadata', modelId: r.modelId })
        controller.enqueue({ type: 'text-start', id })

        let finishReason: LanguageModelV2FinishReason = 'stop'
        let usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }
        let buffer = ''

        for await (const chunk of res.body as any) {
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
            if (delta) controller.enqueue({ type: 'text-delta', id, delta })
            if (choice?.finish_reason) finishReason = FINISH[choice.finish_reason] ?? 'unknown'
            if (json.usage)
              usage = {
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens,
              }
          }
        }

        controller.enqueue({ type: 'text-end', id })
        controller.enqueue({ type: 'finish', finishReason, usage, providerMetadata: metadata(r) })
        controller.close()
      },
    })

    return { stream }
  }
}

export interface AutoOptions {
  /** 'fast' picks the smallest usable model instead of the largest that fits. */
  prefer?: Prefer
  /** false asks a reasoning model to skip thinking. Left alone by default. */
  think?: boolean
}

export function auto(options: AutoOptions = {}): LanguageModelV2 {
  return new AutoModel(options.prefer, options.think)
}

auto.shutdown = shutdown
