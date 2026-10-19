import type { Server } from './types.ts'
import { modelHeaders, within } from './remote.ts'

const PROBES: (Server & { path: string })[] = [
  { backend: 'ollama', baseURL: 'http://127.0.0.1:11434', path: '/api/tags', native: 'ollama' },
  { backend: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1', path: '/models' },
  { backend: 'llama.cpp', baseURL: 'http://127.0.0.1:8080/v1', path: '/models' },
  { backend: 'vllm', baseURL: 'http://127.0.0.1:8000/v1', path: '/models' },
  { backend: 'jan', baseURL: 'http://127.0.0.1:1337/v1', path: '/models' },
]

async function alive(url: string, ms = 500, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: within(ms, signal) })
    return r.ok
  } catch {
    return false
  }
}

/**
 * Rung 1: servers already listening on the standard local ports. Anything
 * else, such as a server on another machine, is a custom endpoint (MOD-16).
 */
export async function reachableServers(signal?: AbortSignal): Promise<Server[]> {
  const hits = await Promise.all(
    PROBES.map(async (p): Promise<Server | null> => {
      if (!(await alive(p.baseURL + p.path, 500, signal))) return null
      return { backend: p.backend, baseURL: p.baseURL, ...(p.native && { native: p.native }) }
    }),
  )
  return hits.filter((s) => s !== null)
}

export interface RawModel {
  id: string
  bytes?: number
  params?: number
  quant?: string
}

export async function listModels(server: Server, signal?: AbortSignal): Promise<RawModel[]> {
  if (server.native === 'ollama') {
    const r = await fetch(`${server.baseURL}/api/tags`, { signal: within(3000, signal) })
    const { models = [] } = (await r.json()) as any
    return models.map((m: any) => ({
      id: m.name,
      bytes: m.size,
      params: parseParams(m.details?.parameter_size),
      quant: m.details?.quantization_level,
    }))
  }
  const r = await fetch(`${server.baseURL}/models`, { headers: modelHeaders(server), signal: within(3000, signal) })
  const { data = [] } = (await r.json()) as any
  return data.map((m: any) => ({ id: m.id }))
}

/**
 * Every chat model on every running local server, for someone choosing one.
 * A server that fails to list is skipped; embedding models cannot chat.
 * Nothing is launched. `signal` stops the probes early.
 */
export async function localModels(signal?: AbortSignal): Promise<{ backend: string; id: string }[]> {
  const servers = await reachableServers(signal)
  const lists = await Promise.all(
    servers.map((s) =>
      listModels(s, signal)
        .then((ms) => ms.map((m) => ({ backend: s.backend, id: m.id })))
        .catch(() => []),
    ),
  )
  return lists.flat().filter((m) => !/embed/i.test(m.id))
}

/** "7.6B" | "8x7B" | "1.1B" -> parameter count */
export function parseParams(s: string | undefined | null): number | undefined {
  if (!s) return undefined
  const moe = /(\d+)\s*x\s*([\d.]+)\s*([BM])/i.exec(s)
  if (moe) return Number(moe[1]) * Number(moe[2]) * (moe[3].toUpperCase() === 'B' ? 1e9 : 1e6)
  const m = /([\d.]+)\s*([BM])\b/i.exec(s)
  if (!m) return undefined
  return Number(m[1]) * (m[2].toUpperCase() === 'B' ? 1e9 : 1e6)
}
