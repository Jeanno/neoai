export type Rung = 'reachable' | 'launched' | 'hosted'

export interface Hardware {
  platform: string
  arch: string
  cores: number
  ramTotalGiB: number
  ramFreeGiB: number
  gpu: string | null
  /** Unified memory on Apple Silicon, dedicated VRAM on NVIDIA, null if CPU-only. */
  vramFreeGiB: number | null
  vramTotalGiB: number | null
}

export interface Server {
  /** Bearer token, when the backend needs one. Never included in metadata. */
  auth?: string
  backend: string
  baseURL: string
  /** Ollama needs its native API for model sizes; everything else is OpenAI-shaped. */
  native?: 'ollama'
}

export interface Candidate {
  id: string
  server: Server
  /** Bytes on disk, or our estimate from parameter count and quantisation. */
  bytes: number
  params: number | null
  quantBits: number | null
  instruct: boolean
  score: number
  reject?: string
}

export interface Resolution {
  rung: Rung
  backend: string
  baseURL: string
  modelId: string
  local: boolean
  contextWindow: number
  reason: string
  rejected: { id: string; why: string }[]
  coldStartMs?: number
  pid?: number
}

/** Which way to break the tie between models that all fit. */
export type Prefer = 'fast'
