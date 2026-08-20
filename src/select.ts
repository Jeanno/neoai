import type { Candidate, Hardware, Server } from './types.ts'
import { memoryBudgetGiB } from './hardware.ts'
import { listModels, parseParams, type RawModel } from './discover.ts'

const GiB = 1024 ** 3

/** Models that answer no chat prompt, whatever their size. */
const NOT_CHAT = /embed|bge-|gte-|e5-|rerank|whisper|clip|stable-?diffusion|moondream-vision/i
const BASE_MODEL = /(^|[-_/])(base|pt)([-_:.]|$)/i
const QUANT_BITS: [RegExp, number][] = [
  [/q2|iq2/i, 2], [/q3|iq3/i, 3], [/q4|iq4|4bit|int4/i, 4], [/q5/i, 5],
  [/q6/i, 6], [/q8|8bit|int8/i, 8], [/f16|fp16|bf16/i, 16], [/f32|fp32/i, 32],
]

function quantBits(...sources: (string | undefined)[]): number | null {
  const hay = sources.filter(Boolean).join(' ')
  for (const [re, bits] of QUANT_BITS) if (re.test(hay)) return bits
  return null
}

/** ~128 KiB/token at 7B with modern GQA; scales with model size. */
function kvBytesPerToken(params: number): number {
  return 128 * 1024 * (params / 7e9)
}

export function evaluate(
  raw: RawModel,
  server: Server,
  hw: Hardware,
  mode: 'free' | 'capacity' = 'capacity',
): Candidate {
  const params = raw.params ?? parseParams(raw.id) ?? null
  const bits = quantBits(raw.quant, raw.id)
  const bytes = raw.bytes ?? (params && bits ? (params * bits) / 8 : 0)
  const instruct = !BASE_MODEL.test(raw.id)
  const budget = memoryBudgetGiB(hw, mode) * GiB

  const c: Candidate = { id: raw.id, server, bytes, params, quantBits: bits, instruct, score: 0 }

  if (NOT_CHAT.test(raw.id)) return { ...c, reject: 'not a chat model' }
  if (bytes && bytes * 1.1 > budget)
    return {
      ...c,
      reject:
        `needs ~${(bytes / GiB).toFixed(1)} GiB + headroom, ` +
        `budget is ${(budget / GiB).toFixed(1)} GiB`,
    }
  if (bits !== null && bits <= 2) return { ...c, reject: 'quantised past usefulness' }

  // Bigger is better, sub-linearly; a base model rarely beats an instruct one.
  let score = Math.log10(params ?? 3e9)
  if (!instruct) score -= 1.5
  if (bits !== null && bits <= 3) score -= 0.4
  if (!bytes) score -= 0.2 // unknown size: we are guessing whether it even fits
  return { ...c, score }
}

export function contextWindow(
  c: Candidate,
  hw: Hardware,
  mode: 'free' | 'capacity' = 'capacity',
  native = 32768,
): number {
  const spare = memoryBudgetGiB(hw, mode) * GiB - c.bytes * 1.1
  if (!c.params || spare <= 0) return Math.min(native, 4096)
  const affordable = Math.floor(spare / kvBytesPerToken(c.params))
  return Math.max(2048, Math.min(native, 2 ** Math.floor(Math.log2(Math.max(affordable, 2048)))))
}

export async function rank(
  servers: Server[],
  hw: Hardware,
  mode: 'free' | 'capacity' = 'capacity',
): Promise<Candidate[]> {
  const all = await Promise.all(
    servers.map(async (s) =>
      (await listModels(s).catch(() => [])).map((m) => evaluate(m, s, hw, mode)),
    ),
  )
  return all.flat().sort((a, b) => Number(!!a.reject) - Number(!!b.reject) || b.score - a.score)
}
