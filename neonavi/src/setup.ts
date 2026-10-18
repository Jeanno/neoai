import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateText } from 'ai'
import { auto, configDir, localModels, pricedModels, probeBackend, reset, type Priced } from 'neorouter'
import { parseModelSpec, resolveChain, type Chosen, type Entry } from './spec.ts'

// Plain when printed into a log, as `--check` is by the installer.
const styled = (code: string) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = styled('1')
const dim = styled('2')

/** What would answer: the label shown to the user, and what to build it from. */
export interface Found {
  label: string
  local: boolean
  /** Which link of the chain answered: 0 is the primary, 1 the fallback. */
  index: number
  options?: Chosen['options']
}

/** Everything setup touches outside itself, so the dialogue can be tested with fakes. */
export interface SetupDeps {
  ask: (prompt: string) => Promise<string | null>
  askSecret: (prompt: string) => Promise<string | null>
  print: (text: string) => void
  /** Resolves a chain afresh: what was missing a moment ago may be running now. */
  probe: (chain: Entry[]) => Promise<Found | null>
  localModels: () => Promise<{ backend: string; id: string }[]>
  pricedModels: (ids: string[]) => Promise<Priced[]>
  validateKey: (key: string) => Promise<'ok' | 'rejected' | 'unreachable'>
  /** The config file's contents, {} when absent. Throws when it is not valid JSON. */
  load: () => Promise<Record<string, any>>
  save: (config: Record<string, any>) => Promise<void>
  tryModel: (found: Found) => Promise<string>
  /** OPENROUTER_API_KEY is set, and wins over a saved key (MOD-10). */
  envKey?: boolean
}

/**
 * Paid OpenRouter models worth offering for navi's work: tool calling and a
 * long context, from cheap to strong (SET-15). Any that leave the catalogue
 * are dropped at display time, so a stale entry costs nothing but a row.
 */
export const PICKS = [
  'deepseek/deepseek-v4.1-flash',
  'anthropic/claude-haiku-5.5',
  'z-ai/glm-5.3',
  'google/gemini-4-argon',
  'anthropic/claude-sonnet-5.5',
]

/** The chain's links as written, with the default spelled out (MOD-2). */
export function links(model: string | string[] | undefined): string[] {
  const parts = (Array.isArray(model) ? model : (model ?? '').split(',')).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : ['remote', 'local']
}

/** Two spellings of the same link, such as `local:x` and `x`, are the same pick. */
const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && JSON.stringify(parseModelSpec(a)) === JSON.stringify(parseModelSpec(b))

/**
 * The chain with one slot replaced (SET-17). The primary is slot 0 and the
 * fallback slot 1; null clears the fallback. Links after the second stay.
 */
export function setSlot(parts: string[], slot: 0 | 1, value: string | null): string[] {
  const next = [...parts]
  if (slot === 0) {
    next[0] = value ?? next[0]
    // A fallback identical to the new primary would only be tried twice.
    if (same(next[1], next[0])) next.splice(1, 1)
  } else if (value === null) next.splice(1, 1)
  else next[1] = value
  return next
}

/** What one link means, in words. */
export function labelFor(part: string): string {
  const [e] = parseModelSpec(part)
  if (e.where === 'free') return 'the free public model (Pollinations)'
  if (e.where === 'remote') return e.id ? `${e.id} on OpenRouter` : 'any free OpenRouter model'
  if (e.id) return `${e.id} on this computer`
  return e.prefer === 'fast' ? 'any local model (fastest)' : 'the largest local model'
}

export function describe(found: Found | null): string {
  if (!found) return "navi can't find a model to answer with."
  const slot = ['the primary', 'the fallback'][found.index] ?? `link ${found.index + 1}`
  const where = found.local ? 'on this computer' : 'REMOTE: prompts leave this computer'
  return `navi answers with ${bold(found.label)}, ${slot} (${where}).`
}

function showSlots(d: SetupDeps, parts: string[], found: Found | null) {
  d.print(`\n  Primary   ${labelFor(parts[0])}`)
  d.print(`  Fallback  ${parts[1] ? labelFor(parts[1]) : 'none'}`)
  if (parts.length > 2) d.print(`  Then      ${parts.slice(2).map(labelFor).join(', ')}`)
  d.print(`\n${describe(found)}`)
}

const LOCAL_HELP = `
To run a model on this computer, install one of these:

  LM Studio  https://lmstudio.ai
             Download a model in the Discover tab (a 4B or 8B model is a good
             start), then switch the server on in the Developer tab.
  Ollama     https://ollama.com
             Then download a model in a terminal: ollama pull qwen3:4b

navi finds either one by itself.`

const FREE_WARNING = `
The free model is run by Pollinations (pollinations.ai), a public service.
Your prompts, and the contents of any files navi reads to answer them, are sent
there. Don't use it for anything private or confidential.`

/** Printed by --check when nothing answers: the next step, not just the failure. */
export const NEXT_STEP = 'Run `navi setup` to choose a model, or start LM Studio or Ollama and try again.'

/** Setup's view of the config, changed as keys and picks are saved. */
interface State {
  config: Record<string, any>
}

type Outcome<T> = T | 'back' | 'eof'

async function addLocal(d: SetupDeps): Promise<Outcome<'found'>> {
  d.print(LOCAL_HELP)
  for (;;) {
    const a = await d.ask(`\nPress Enter to check again, or b to go back: `)
    if (a === null) return 'eof'
    if (a.trim().toLowerCase() === 'b') return 'back'
    // A probe, not just a listing: it starts an installed Ollama that is not running.
    const found = await d.probe([{ where: 'local', prefer: 'fast' }])
    if (found) {
      d.print(`Found ${bold(found.label)}.`)
      return 'found'
    }
    d.print('Nothing yet. Is a model downloaded, and (in LM Studio) is the server on?')
  }
}

async function addKey(d: SetupDeps, s: State): Promise<Outcome<'saved'>> {
  d.print('\nCreate a key at https://openrouter.ai/keys.')
  if (d.envKey) d.print(dim('OPENROUTER_API_KEY is set in your environment; it is used instead of a saved key.'))
  const key = (await d.askSecret('Paste your OpenRouter key (it stays hidden): '))?.trim()
  if (key === undefined) return 'eof'
  if (!key) return 'back'
  const verdict = await d.validateKey(key)
  if (verdict === 'rejected') {
    d.print("OpenRouter didn't accept that key. Nothing was saved.")
    return 'back'
  }
  if (verdict === 'unreachable') {
    d.print("Couldn't reach OpenRouter to check the key. Nothing was saved; check your connection and try again.")
    return 'back'
  }
  s.config = { ...s.config, keys: { ...s.config.keys, openrouter: key } }
  await d.save(s.config)
  d.print(dim('Key saved.'))
  return 'saved'
}

async function addFree(d: SetupDeps): Promise<Outcome<'free'>> {
  d.print(FREE_WARNING)
  const a = await d.ask('Use it? [y/N] ')
  if (a === null) return 'eof'
  return a.trim().toLowerCase() === 'y' ? 'free' : 'back'
}

interface Row {
  label: string
  /** The link to save; null clears the fallback. */
  value?: string | null
  add?: 'local' | 'key' | 'free'
}

/** One slot's choices, grouped by source (SET-14 to SET-16). */
async function rowsFor(d: SetupDeps, s: State, slot: 0 | 1): Promise<[string, Row[]][]> {
  const parts = links(s.config.model)
  const locals = await d.localModels()
  const groups: [string, Row[]][] = []
  if (slot === 1) groups.push(['', [{ label: 'none', value: null }]])
  groups.push([
    locals.length ? 'On this computer' : 'On this computer (nothing running)',
    [
      ...locals.map((m) => ({ label: `${m.backend} · ${m.id}`, value: `local:${m.id}` })),
      { label: 'any local model (fastest)', value: 'local' },
    ],
  ])
  if (d.envKey || s.config.keys?.openrouter) {
    const paid = (await d.pricedModels(PICKS)).sort((a, b) => a.output - b.output || a.input - b.input)
    groups.push([
      'OpenRouter (priced models bill your key, per million tokens in / out)',
      [
        { label: 'any free model (largest context)', value: 'remote' },
        ...paid.map((p) => ({ label: `${p.id}  $${p.input} / $${p.output}`, value: p.id })),
      ],
    ])
  }
  if (parts.some((p) => same(p, 'free'))) groups.push(['Public', [{ label: labelFor('free'), value: 'free' }]])
  groups.push([
    'Add',
    [
      { label: '+ a local model (LM Studio, Ollama)', add: 'local' },
      { label: '+ an OpenRouter key', add: 'key' },
      { label: '+ the free public model', add: 'free' },
    ],
  ])
  // The fallback is never the primary again.
  const primary = slot === 1 ? parts[0] : undefined
  return groups
    .map(([name, rows]): [string, Row[]] => [name, rows.filter((r) => !r.value || !same(r.value, primary))])
    .filter(([, rows]) => rows.length)
}

async function pick(d: SetupDeps, s: State, slot: 0 | 1): Promise<Outcome<string | null>> {
  const name = slot === 0 ? 'primary' : 'fallback'
  for (;;) {
    const current = links(s.config.model)[slot]
    const groups = await rowsFor(d, s, slot)
    const rows: Row[] = []
    d.print(`\nChoose a ${name} model:`)
    for (const [group, rs] of groups) {
      if (group) d.print(`  ${dim(group)}`)
      for (const r of rs) {
        rows.push(r)
        const mark = r.value === undefined ? '' : (r.value === null ? !current : same(r.value, current)) ? dim('  (current)') : ''
        d.print(`   ${String(rows.length).padStart(2)}  ${r.label}${mark}`)
      }
    }
    const a = await d.ask('\nNumber, or Enter to go back: ')
    if (a === null) return 'eof'
    if (!a.trim()) return 'back'
    const row = rows[Number(a.trim()) - 1]
    if (!row) continue
    if (row.value !== undefined) return row.value
    const added = row.add === 'local' ? await addLocal(d) : row.add === 'key' ? await addKey(d, s) : await addFree(d)
    if (added === 'eof') return 'eof'
    if (added === 'free') return 'free'
    // Found or saved: the list is drawn again with the new models in it.
  }
}

/** Runs setup and returns the exit code: 0 once something answers. */
export async function runSetup(d: SetupDeps, { check = false } = {}): Promise<number> {
  const s: State = { config: {} }
  try {
    s.config = await d.load()
  } catch (e) {
    // Overwriting a file we cannot read would lose whatever was in it (SET-9).
    d.print(`setup: ${e instanceof Error ? e.message : e}. Fix or remove it, then run navi setup again.`)
    return 1
  }

  d.print(dim('Looking for a model…'))
  let found = await d.probe(parseModelSpec(links(s.config.model)))
  if (check) {
    d.print(describe(found))
    if (!found) d.print(NEXT_STEP)
    return found ? 0 : 1
  }
  showSlots(d, links(s.config.model), found)

  for (;;) {
    d.print(`\n  1  Change the primary model\n  2  Change the fallback`)
    const c = (await d.ask('\nChoose, or press Enter to finish: '))?.trim().toLowerCase()
    if (c === undefined || c === '' || c === 'q') return found ? 0 : 1
    if (c !== '1' && c !== '2') continue
    const slot = c === '1' ? 0 : 1
    const got = await pick(d, s, slot)
    if (got === 'eof') return found ? 0 : 1
    if (got === 'back') continue

    const parts = links(s.config.model)
    const next = setSlot(parts, slot, got)
    if (JSON.stringify(next) !== JSON.stringify(parts)) {
      s.config = { ...s.config, model: next }
      await d.save(s.config)
      d.print(dim('Saved.'))
    }
    found = await d.probe(parseModelSpec(next))
    showSlots(d, next, found)
    if (!found) continue
    d.print(dim('Asking it a test question…'))
    try {
      d.print(await d.tryModel(found))
    } catch (e) {
      d.print(`The model didn't answer: ${e instanceof Error ? e.message : e}`)
    }
  }
}

/** The real filesystem, network and models behind runSetup. */
export function realDeps(io: Pick<SetupDeps, 'ask' | 'askSecret' | 'print'>, dir = configDir()): SetupDeps {
  const file = join(dir, 'config.json')
  return {
    ...io,
    envKey: !!process.env.OPENROUTER_API_KEY,
    probe: async (chain) => {
      // Failures are memoised too, and setup asks again after things change.
      reset()
      const chosen = await resolveChain(chain)
      if (!chosen) return null
      const { prefer, remote, model, scope } = chosen.options
      const r = await probeBackend(prefer, remote, model, scope)
      return (
        r && { label: `${r.backend} · ${r.modelId}`, local: r.local, index: chain.indexOf(chosen.entry), options: chosen.options }
      )
    },
    localModels,
    pricedModels,
    validateKey: async (key) => {
      try {
        // The key endpoint answers 401 for a bad key and costs nothing to call.
        const res = await fetch('https://openrouter.ai/api/v1/key', {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) return 'ok'
        return res.status === 401 || res.status === 403 ? 'rejected' : 'unreachable'
      } catch {
        return 'unreachable'
      }
    },
    load: async () => {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        return {}
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${file} is not valid JSON`)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`)
      return parsed as Record<string, any>
    },
    save: async (config) => {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      // Written aside and renamed, so a crash never leaves half a config.
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
      await rename(tmp, file)
      await chmod(file, 0o600)
    },
    tryModel: async (found) => {
      const { text } = await generateText({
        model: auto(found.options),
        prompt: 'Say hello in one short sentence.',
        abortSignal: AbortSignal.timeout(120_000),
      })
      if (!text.trim()) throw new Error('it returned an empty reply')
      return text.trim()
    },
  }
}
