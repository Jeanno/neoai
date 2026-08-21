import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'
import type { Resolved } from './resolve.ts'
import { resolveBackend } from './resolve.ts'
import { shutdown } from './launch.ts'
import { serialize } from './hosted.ts'
import type { Server } from './types.ts'

function chatEndpoint(server: Server, backend: string): string {
  if (server.native === 'ollama') return `${server.baseURL}/v1/chat/completions`
  if (backend === 'pollinations') return server.baseURL
  return `${server.baseURL}/chat/completions`
}

interface OaiMessage {
  role: string
  content: string
}

function toMessages(prompt: LanguageModelV2CallOptions['prompt']): {
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
      warnings.push({ type: 'other', message: 'tool results are not supported yet' })
      continue
    }
    const text = m.content
      .map((p) => {
        if (p.type === 'text') return p.text
        warnings.push({ type: 'other', message: `dropped unsupported ${p.type} part` })
        return ''
      })
      .join('')
    if (text) messages.push({ role: m.role, content: text })
  }
  return { messages, warnings }
}

function body(o: LanguageModelV2CallOptions, r: Resolved, stream: boolean) {
  const { messages, warnings } = toMessages(o.prompt)
  if (o.responseFormat?.type === 'json')
    warnings.push({ type: 'other', message: 'JSON mode is not supported yet' })
  if (o.tools?.length)
    warnings.push({ type: 'other', message: 'tool calling is not supported yet' })
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

  get provider() {
    return this.resolution ? `neorouter:${this.resolution.backend}` : 'neorouter'
  }

  get modelId() {
    return this.resolution?.modelId ?? 'auto'
  }

  private async ready(): Promise<Resolved> {
    return (this.resolution ??= await resolveBackend())
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const r = await this.ready()
    const { payload, warnings } = body(options, r, false)
    const res = await post(chatEndpoint(r.server, r.backend), payload, !r.local)
    const json = (await res.json()) as any
    const choice = json.choices?.[0]
    return {
      content: [{ type: 'text' as const, text: choice?.message?.content ?? '' }],
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
    const { payload, warnings } = body(options, r, true)
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

export function auto(): LanguageModelV2 {
  return new AutoModel()
}

auto.shutdown = shutdown
