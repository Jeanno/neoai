import { configDir } from 'neorouter'
import {
  describe,
  LOCAL_HELP,
  NEXT_STEP,
  realDeps as coreDeps,
  setupCore,
  type Choice,
  type ProviderRow,
  type SetupCore,
  type Slot,
  type Status,
} from './setup-core.ts'

export { NEXT_STEP }

// Plain when printed into a log, as `--check` is by the installer.
const styled = (code: string) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = styled('1')
const dim = styled('2')

/** The terminal: how `navi setup` asks and tells. */
export interface SetupIO {
  /** The line typed, or null at EOF or ^C. */
  ask: (prompt: string) => Promise<string | null>
  askSecret: (prompt: string) => Promise<string | null>
  print: (text: string) => void
}

export interface SetupDeps extends SetupIO {
  core: SetupCore
}

/** The terminal front end over the real core (SET-23). */
export function realDeps(io: SetupIO, dir = configDir()): SetupDeps {
  return { ...io, core: setupCore(coreDeps(dir)) }
}

type Outcome<T> = T | 'back' | 'eof'

interface Row {
  label: string
  detail?: string
  current?: boolean
}

/**
 * A numbered list; returns the index picked. With `filter`, typing anything
 * that is not a number narrows the list, for model lists hundreds long.
 */
async function choose(d: SetupIO, title: string, rows: Row[], { filter = false } = {}): Promise<Outcome<number>> {
  let shown = rows.map((r, i) => ({ ...r, i }))
  for (;;) {
    d.print(`\n${title}`)
    shown.forEach((r, n) => {
      const detail = r.detail ? dim(`  ${r.detail}`) : ''
      const mark = r.current ? dim('  (current)') : ''
      d.print(`   ${String(n + 1).padStart(2)}  ${r.label}${detail}${mark}`)
    })
    if (!shown.length) d.print(dim('   nothing matches'))
    const a = await d.ask(filter ? '\nNumber, text to search, or Enter to go back: ' : '\nNumber, or Enter to go back: ')
    if (a === null) return 'eof'
    const t = a.trim()
    if (!t) {
      if (shown.length === rows.length) return 'back'
      shown = rows.map((r, i) => ({ ...r, i }))
      continue
    }
    if (/^\d+$/.test(t)) {
      const hit = shown[Number(t) - 1]
      if (hit) return hit.i
      continue
    }
    if (filter) shown = rows.map((r, i) => ({ ...r, i })).filter((r) => r.label.toLowerCase().includes(t.toLowerCase()))
  }
}

const SLOT_NAME = ['primary', 'fallback']

/** Words into lines of at most `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1)
    if (last !== undefined && last.length + word.length < width) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

function showStatus(d: SetupIO, s: Status) {
  d.print(`\n  Primary   ${s.primary.label}`)
  d.print(`  Fallback  ${s.fallback?.label ?? 'none'}`)
  if (s.later.length) d.print(`  Then      ${s.later.map((l) => l.label).join(', ')}`)
  d.print(`\n${describe(s.answering, bold)}`)
}

/** SET-6: asks for a key without echo, checks it, and saves it only when accepted. */
async function enterKey(d: SetupDeps, p: ProviderRow): Promise<Outcome<'saved'>> {
  d.print(`\nCreate a key at ${p.keyPage}`)
  if (p.key === 'env') d.print(dim(`${p.env} is set in your environment; it is used instead of a saved key.`))
  const key = await d.askSecret(`Paste your ${p.name} key (it stays hidden): `)
  if (key === null) return 'eof'
  if (!key.trim()) return 'back'
  d.print(dim('Checking the key…'))
  const saved = await d.core.saveKey(p.id, key)
  if (!saved.ok) {
    d.print(saved.message)
    return 'back'
  }
  d.print(dim('Key saved.'))
  return 'saved'
}

async function pickFrom(d: SetupDeps, title: string, choices: Choice[]): Promise<Outcome<string | null>> {
  const i = await choose(d, title, choices, { filter: choices.length > 20 })
  return typeof i === 'number' ? choices[i].value : i
}

/** SET-20: the hand-picked models, then all of them, then replacing the key. */
async function providerModels(d: SetupDeps, slot: Slot, p: ProviderRow): Promise<Outcome<string>> {
  for (;;) {
    const list = await d.core.providerModels(p.id, slot)
    if (!list.ok) d.print(list.message)
    const picks = list.ok ? list.recommended : []
    const rows: Row[] = [...picks, ...(list.ok ? [{ label: 'All models…' }] : []), { label: 'Replace the key' }]
    const i = await choose(d, `${p.name}:`, rows)
    if (typeof i !== 'number') return i
    if (i < picks.length) return picks[i].value!
    if (list.ok && i === picks.length) {
      const got = await pickFrom(d, `All ${p.name} models:`, list.all)
      if (got === 'eof') return 'eof'
      if (got !== 'back' && got !== null) return got
      continue
    }
    if ((await enterKey(d, p)) === 'eof') return 'eof'
  }
}

/** SET-19 */
async function providers(d: SetupDeps, slot: Slot): Promise<Outcome<string>> {
  for (;;) {
    const rows = await d.core.providers()
    const i = await choose(
      d,
      'Providers:',
      rows.map((p) => ({ label: p.name, detail: p.key === 'saved' ? 'key saved' : p.key === 'env' ? `key from ${p.env}` : undefined })),
    )
    if (typeof i !== 'number') return i
    const p = rows[i]
    if (!p.key) {
      const added = await enterKey(d, p)
      if (added === 'eof') return 'eof'
      if (added === 'back') continue
    }
    const got = await providerModels(d, slot, p)
    if (got !== 'back') return got
  }
}

/** SET-5: how to get a local model, then a fresh look each time the user asks. */
async function localHelp(d: SetupDeps): Promise<Outcome<'found'>> {
  d.print('\nTo run a model on this computer, install one of these:\n')
  const indent = ' '.repeat(13)
  for (const h of LOCAL_HELP) d.print(`  ${h.name.padEnd(10)} ${h.url}\n${wrap(h.steps, 64).map((l) => indent + l).join('\n')}`)
  d.print('\nnavi finds either one by itself.')
  for (;;) {
    const a = await d.ask('\nPress Enter to check again, or b to go back: ')
    if (a === null) return 'eof'
    if (a.trim().toLowerCase() === 'b') return 'back'
    const found = await d.core.recheckLocal()
    if (found) {
      d.print(`Found ${bold(found.label)}.`)
      return 'found'
    }
    d.print('Nothing yet. Is a model downloaded, and (in LM Studio) is the server on?')
  }
}

/** SET-21 */
async function local(d: SetupDeps, slot: Slot): Promise<Outcome<string>> {
  for (;;) {
    const choices = await d.core.localModels(slot)
    const running = choices.some((c) => c.value !== 'local')
    const rows: Row[] = [...choices, { label: 'Help getting a model' }]
    const i = await choose(d, running ? 'On this computer:' : 'On this computer (nothing running):', rows)
    if (typeof i !== 'number') return i
    if (i < choices.length) return choices[i].value!
    if ((await localHelp(d)) === 'eof') return 'eof'
  }
}

/** SET-22: a name, a base URL and an optional key, checked before saving. */
async function addEndpoint(d: SetupDeps): Promise<Outcome<string>> {
  let name: string
  for (;;) {
    const a = await d.ask('\nName for the endpoint (e.g. homelab): ')
    if (a === null) return 'eof'
    if (!a.trim()) return 'back'
    const bad = d.core.checkCustomName(a)
    if (!bad) {
      name = a.trim()
      break
    }
    d.print(bad)
  }
  const url = await d.ask('Base URL (e.g. http://my-server:8000/v1): ')
  if (url === null) return 'eof'
  if (!url.trim()) return 'back'
  const key = await d.askSecret('Key, or Enter for none (it stays hidden): ')
  if (key === null) return 'eof'
  d.print(dim('Checking the endpoint…'))
  const added = await d.core.addCustom({ name, baseURL: url, key })
  if (!added.ok) {
    d.print(added.message)
    return 'back'
  }
  d.print(dim(`Saved ${name} (${added.baseURL}).`))
  return name
}

async function customModels(d: SetupDeps, slot: Slot, name: string): Promise<Outcome<string>> {
  const list = await d.core.customModels(name, slot)
  if (!list.ok) {
    d.print(list.message)
    return 'back'
  }
  const got = await pickFrom(d, `${name}:`, list.all)
  return got === null ? 'back' : got
}

async function custom(d: SetupDeps, slot: Slot): Promise<Outcome<string>> {
  for (;;) {
    const saved = await d.core.customs()
    const i = await choose(d, 'Custom endpoints:', [
      ...saved.map((c) => ({ label: c.name, detail: c.baseURL })),
      { label: 'Add an endpoint' },
    ])
    if (typeof i !== 'number') return i
    const name = i < saved.length ? saved[i].name : await addEndpoint(d)
    if (name === 'eof') return 'eof'
    if (name === 'back') continue
    const got = await customModels(d, slot, name)
    if (got !== 'back') return got
  }
}

/** SET-18: Providers, Local or Custom; the fallback also offers none. */
async function pick(d: SetupDeps, slot: Slot): Promise<Outcome<string | null>> {
  for (;;) {
    const menu = await d.core.slotMenu(slot)
    const rows: Row[] = [...menu.groups, ...(menu.none ? [menu.none] : [])]
    const i = await choose(d, `Choose the ${SLOT_NAME[slot]} model from:`, rows)
    if (typeof i !== 'number') return i
    if (i >= menu.groups.length) return null
    const group = menu.groups[i].id
    const got = group === 'providers' ? await providers(d, slot) : group === 'local' ? await local(d, slot) : await custom(d, slot)
    if (got !== 'back') return got
  }
}

/** Runs setup and returns the exit code: 0 once something answers (SET-12). */
export async function runSetup(d: SetupDeps, { check = false } = {}): Promise<number> {
  try {
    await d.core.load()
  } catch (e) {
    // Overwriting a file we cannot read would lose whatever was in it (SET-9).
    d.print(`setup: ${e instanceof Error ? e.message : e}. Fix or remove it, then run navi setup again.`)
    return 1
  }

  d.print(dim('Looking for a model…'))
  let status = await d.core.status()
  const code = () => (status.answering ? 0 : 1)
  if (check) {
    d.print(describe(status.answering, bold))
    if (!status.answering) d.print(NEXT_STEP)
    return code()
  }
  showStatus(d, status)

  for (;;) {
    d.print(`\n  1  Change the primary model\n  2  Change the fallback`)
    const c = (await d.ask('\nChoose, or press Enter to finish: '))?.trim().toLowerCase()
    if (c === undefined || c === '' || c === 'q') return code()
    if (c !== '1' && c !== '2') continue
    const slot: Slot = c === '1' ? 0 : 1
    const got = await pick(d, slot)
    if (got === 'eof') return code()
    if (got === 'back') continue

    const set = await d.core.setSlot(slot, got)
    status = set.status
    if (set.changed) d.print(dim('Saved.'))
    showStatus(d, status)
    if (!status.answering) continue
    d.print(dim('Asking it a test question…'))
    const t = await d.core.test(status.answering)
    d.print(t.ok ? t.reply : `The model didn't answer: ${t.error}`)
  }
}
