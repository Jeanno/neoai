import type { Tokens } from './ledger.ts'

/** US dollars per million tokens; `cached` is a cache read, `in`'s price when left out (LED-20). */
export interface Price {
  in: number
  out: number
  cached?: number
}

/**
 * List prices, as of November 2026 (LED-19). Prompts over 100K tokens cost
 * Haiku 5.5 more; an estimate does not tell them apart.
 */
const LIST: Record<string, Price> = {
  'claude-fable-5-1': { in: 10, out: 50, cached: 0.25 },
  'claude-fable-5': { in: 10, out: 50, cached: 1 },
  'claude-opus-5-5': { in: 4, out: 20, cached: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cached: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, cached: 0.5 },
  'claude-opus-4-7': { in: 5, out: 25, cached: 0.5 },
  'claude-opus-4-6': { in: 5, out: 25, cached: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cached: 0.2 },
  'claude-sonnet-5': { in: 2, out: 10, cached: 0.2 },
  'claude-sonnet-4-6': { in: 3, out: 15, cached: 0.3 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cached: 0.01 },
  'claude-haiku-4-5': { in: 1, out: 5, cached: 0.1 },
}

/** The model id in a ledger name (`claude-sonnet-5-5 on Anthropic`, `anthropic/claude-sonnet-5.5 on OpenRouter`). */
export function modelId(name: string): string {
  return name.replace(/ on [^·]*$/, '').replace(/^.* · /, '').trim()
}

/** A model's price: the config's first (by id as the ledger names it), then the list's. */
export function priceOf(name: string, own: Record<string, unknown> = {}): Price | undefined {
  const id = modelId(name)
  const given = own[id]
  if (isPrice(given)) return given
  return LIST[id.split('/').at(-1)!.toLowerCase().replace(/\./g, '-')]
}

const isPrice = (p: unknown): p is Price =>
  !!p && typeof p === 'object' && typeof (p as Price).in === 'number' && typeof (p as Price).out === 'number'

/** What tokens cost at a price, in dollars. */
export function cost(t: Tokens, p: Price): number {
  const cached = Math.min(t.cached ?? 0, t.in)
  return ((t.in - cached) * p.in + cached * (p.cached ?? p.in) + t.out * p.out) / 1e6
}
