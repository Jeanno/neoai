import type { Server } from './types.ts'
import { modelHeaders } from './remote.ts'

const PROBES: (Server & { path: string })[] = [
  { backend: 'ollama', baseURL: 'http://127.0.0.1:11434', path: '/api/tags', native: 'ollama' },
  { backend: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1', path: '/models' },
  { backend: 'llama.cpp', baseURL: 'http://127.0.0.1:8080/v1', path: '/models' },
  { backend: 'vllm', baseURL: 'http://127.0.0.1:8000/v1', path: '/models' },
  { backend: 'jan', baseURL: 'http://127.0.0.1:1337/v1', path: '/models' },
]

async function alive(url: string, ms = 500): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
    return r.ok
  } catch {
    return false
  }
}

/**
 * Rung 1: servers already listening on the standard local ports. Anything
 * else, such as a server on another machine, is a custom endpoint (MOD-16).
 */
export async function reachableServers(): Promise<Server[]> {
  const hits = await Promise.all(
    PROBES.map(async (p): Promise<Server | null> => {
      if (!(await alive(p.baseURL + p.path))) return null
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

export async function listModels(server: Server): Promise<RawModel[]> {
  if (server.native === 'ollama') {
    const r = await fetch(`${server.baseURL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    const { models = [] } = (await r.json()) as any
    return models.map((m: any) => ({
      id: m.name,
      bytes: m.size,
      params: parseParams(m.details?.parameter_size),
      quant: m.details?.quantization_level,
    }))
  }
  const r = await fetch(`${server.baseURL}/models`, { headers: modelHeaders(server), signal: AbortSignal.timeout(3000) })
  const { data = [] } = (await r.json()) as any
  return data.map((m: any) => ({ id: m.id }))
}

/** "7.6B" | "8x7B" | "1.1B" -> parameter count */
/**
 * Every chat model on every running local server, for someone choosing one.
 * A server that fails to list is skipped; embedding models cannot chat.
 */
export async function localModels(): Promise<{ backend: string; id: string }[]> {
  const servers = await reachableServers()
  const lists = await Promise.all(
    servers.map((s) =>
      listModels(s)
        .then((ms) => ms.map((m) => ({ backend: s.backend, id: m.id })))
        .catch(() => []),
    ),
  )
  return lists.flat().filter((m) => !/embed/i.test(m.id))
}

export function parseParams(s: string | undefined | null): number | undefined {
  if (!s) return undefined
  const moe = /(\d+)\s*x\s*([\d.]+)\s*([BM])/i.exec(s)
  if (moe) return Number(moe[1]) * Number(moe[2]) * (moe[3].toUpperCase() === 'B' ? 1e9 : 1e6)
  const m = /([\d.]+)\s*([BM])\b/i.exec(s)
  if (!m) return undefined
  return Number(m[1]) * (m[2].toUpperCase() === 'B' ? 1e9 : 1e6)
}
