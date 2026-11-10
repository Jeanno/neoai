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

/** SET-2, SET-27: the core's next step, and how to take it from a terminal. */
export const CLI_NEXT_STEP = `${NEXT_STEP} To choose one, run \`navi setup\`.`

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
  /** A heading drawn above the row, starting a section (SET-30). */
  heading?: string
}

/**
 * A numbered list; returns the index picked, or a letter of `keys`, each
 * drawn below the list with what it does. With `filter`, typing anything
 * that is not a number narrows the list, for model lists hundreds long.
 */
async function choose(
  d: SetupIO,
  title: string,
  rows: Row[],
  { filter = false, keys = {}, prompt, note = [] }: { filter?: boolean; keys?: Record<string, string>; prompt?: string; note?: string[] } = {},
): Promise<Outcome<number | string>> {
  let shown = rows.map((r, i) => ({ ...r, i }))
  for (;;) {
    d.print(`\n${title}`)
    // Details start in one column, so they read as a second column.
    const wide = Math.max(0, ...shown.filter((r) => r.detail).map((r) => r.label.length))
    shown.forEach((r, n) => {
      if (r.heading && shown.length === rows.length) d.print(`  ${bold(r.heading)}`)
      const detail = r.detail ? dim(`  ${' '.repeat(wide - r.label.length)}${r.detail}`) : ''
      const mark = r.current ? dim('  (current)') : ''
      d.print(`   ${String(n + 1).padStart(2)}  ${r.label}${detail}${mark}`)
    })
    if (!shown.length) d.print(dim('   nothing matches'))
    for (const [k, what] of Object.entries(keys)) d.print(`\n    ${k}  ${what}`)
    // SET-33: what just changed, where it is seen, right above the question.
    if (note.length) d.print('')
    for (const line of note) d.print(`  ${line}`)
    const a = await d.ask(prompt ?? (filter ? '\nNumber, text to search, or Enter to go back: ' : '\nNumber, or Enter to go back: '))
    if (a === null) return 'eof'
    const t = a.trim()
    if (t.toLowerCase() in keys) return t.toLowerCase()
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
  d.print(`\n  Model   ${s.primary.label}`)
  d.print(`  Backup  ${s.fallback?.label ?? 'none'}`)
  if (s.later.length) d.print(`  Then      ${s.later.map((l) => l.label).join(', ')}`)
  d.print(`\n${describe(s.answering, bold, s)}`)
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

/** Asks before removing anything (SET-28); true only for a yes. */
async function confirm(d: SetupIO, question: string): Promise<Outcome<boolean>> {
  const a = await d.ask(`${question} [y/N] `)
  if (a === null) return 'eof'
  return /^y(es)?$/i.test(a.trim())
}

/** SET-28: deletes the saved key; one from the environment stays in use. */
async function removeKey(d: SetupDeps, p: ProviderRow): Promise<Outcome<'removed'>> {
  const sure = await confirm(d, `\nRemove the saved ${p.name} key?`)
  if (sure !== true) return sure === 'eof' ? 'eof' : 'back'
  const removed = await d.core.removeKey(p.id)
  if (!removed.ok) {
    d.print(removed.message)
    return 'back'
  }
  d.print(dim(removed.still ? `Key removed. ${p.name} still has one from ${removed.still}.` : 'Key removed.'))
  return 'removed'
}

async function pickFrom(d: SetupDeps, title: string, choices: Choice[]): Promise<Outcome<string | null>> {
  const i = await choose(d, title, choices, { filter: choices.length > 20 })
  return typeof i === 'number' ? choices[i].value : i === 'eof' ? 'eof' : 'back'
}

/** SET-20: the hand-picked models, then all of them, then replacing the key. */
async function providerModels(d: SetupDeps, slot: Slot, p: ProviderRow): Promise<Outcome<string>> {
  for (;;) {
    const list = await d.core.providerModels(p.id, slot)
    if (!list.ok) d.print(list.message)
    const picks = list.ok ? list.recommended : []
    const rows: Row[] = [
      ...picks,
      ...(list.ok ? [{ label: 'All models…' }] : []),
      { label: 'Replace the key' },
      // Looked up afresh: a key entered a moment ago is saved now.
      ...((await d.core.providers()).find((r) => r.id === p.id)?.key === 'saved' ? [{ label: 'Remove the saved key' }] : []),
    ]
    const i = await choose(d, `Models on ${p.name}:`, rows)
    if (typeof i !== 'number') return i === 'eof' ? 'eof' : 'back'
    if (i < picks.length) return picks[i].value!
    if (list.ok && i === picks.length) {
      const got = await pickFrom(d, `All models on ${p.name}:`, list.all)
      if (got === 'eof') return 'eof'
      if (got !== 'back' && got !== null) return got
      continue
    }
    if (rows[i].label === 'Remove the saved key') {
      const removed = await removeKey(d, p)
      if (removed === 'eof') return 'eof'
      if (removed === 'removed') return 'back'
      continue
    }
    if ((await enterKey(d, p)) === 'eof') return 'eof'
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
  // SET-31: an empty list says why, rather than asking for a number of nothing.
  if (!list.all.length) {
    d.print(
      list.taken
        ? `\n${name} serves only ${bold(list.taken)}, and that is already the model. A backup has to be a different model, so pick another server or provider, or none.`
        : `\n${name} lists no models right now. It may be busy or still starting; try again in a moment.`,
    )
    return 'back'
  }
  const got = await pickFrom(d, `Models on ${name}:`, list.all)
  return got === null ? 'back' : got
}

/** SET-28: one that a link in the chain uses is kept, and setup says which. */
async function removeEndpoint(d: SetupDeps, names: string[]): Promise<Outcome<'removed'>> {
  const i = await choose(d, 'Remove which server?', names.map((label) => ({ label })))
  if (typeof i !== 'number') return i === 'eof' ? 'eof' : 'back'
  const sure = await confirm(d, `\nRemove ${names[i]}?`)
  if (sure !== true) return sure === 'eof' ? 'eof' : 'back'
  const removed = await d.core.removeCustom(names[i])
  d.print(removed.ok ? dim(`Removed ${names[i]}.`) : removed.message)
  return removed.ok ? 'removed' : 'back'
}

type Act =
  | { kind: 'model'; value: string | null }
  | { kind: 'help' }
  | { kind: 'provider'; p: ProviderRow }
  | { kind: 'server'; name: string }
  | { kind: 'add' }
  | { kind: 'remove' }

const SERVERS = 'Your own server, any that speaks the OpenAI API'

/**
 * SET-30: every way to answer in one list, for the model and the backup
 * alike: on this computer, with your API key, on your own server. A provider
 * or a server goes on to its models; the backup also offers none. With
 * `keys`, the list is setup's first screen and Enter finishes.
 */
async function pick(d: SetupDeps, slot: Slot, now: string | undefined, keys: Record<string, string> = {}, prompt?: string, note: string[] = []): Promise<Outcome<string | null>> {
  // The provider or server the slot's model is on now is marked, as a local model is.
  const on = (name: string) => !!now?.endsWith(` on ${name}`)
  // The note is for the first drawing; going back into the list drops it.
  let noted = false
  const shownOnce = (lines: string[]) => (noted ? [] : ((noted = true), lines))
  for (;;) {
    const [here, providers, servers, menu] = await Promise.all([d.core.localModels(slot), d.core.providers(), d.core.customs(), d.core.slotMenu(slot)])
    const running = here.some((c) => c.value !== 'local')
    const rows: (Row & { act: Act })[] = [
      ...here.map((c, i) => ({ ...c, heading: i === 0 ? (running ? 'On this computer' : 'On this computer (nothing running now)') : undefined, act: { kind: 'model', value: c.value } as Act })),
      ...(running ? [] : [{ label: 'Help getting a model', detail: 'LM Studio or Ollama', heading: here.length ? undefined : 'On this computer', act: { kind: 'help' } as Act }]),
      ...providers.map((p, i) => ({
        label: p.name,
        detail: p.key === 'saved' ? 'key saved' : p.key === 'env' ? `key from ${p.env}` : undefined,
        heading: i === 0 ? 'With your API key' : undefined,
        current: on(p.name),
        act: { kind: 'provider', p } as Act,
      })),
      ...servers.map((c, i) => ({ label: c.name, detail: c.baseURL, current: on(c.name), heading: i === 0 ? SERVERS : undefined, act: { kind: 'server', name: c.name } as Act })),
      { label: 'Add a server', detail: 'its URL, and a key if it needs one', heading: servers.length ? undefined : SERVERS, act: { kind: 'add' } },
      ...(servers.length ? [{ label: 'Remove a server', act: { kind: 'remove' } as Act }] : []),
      ...(menu.none ? [{ ...menu.none, heading: 'No backup', act: { kind: 'model', value: null } as Act }] : []),
    ]
    const title = slot === 0 ? 'Choose the model navi answers with:' : 'Choose a backup, for when the model does not answer:'
    const i = await choose(d, title, rows, { keys, prompt, note: shownOnce(note) })
    if (typeof i !== 'number') return i
    const act = rows[i].act
    let got: Outcome<string | null> = 'back'
    if (act.kind === 'model') return act.value
    if (act.kind === 'help') got = (await localHelp(d)) === 'eof' ? 'eof' : 'back'
    if (act.kind === 'provider') {
      const added = act.p.key ? 'saved' : await enterKey(d, act.p)
      got = added === 'saved' ? await providerModels(d, slot, act.p) : added
    }
    if (act.kind === 'server') got = await customModels(d, slot, act.name)
    if (act.kind === 'add') {
      const name = await addEndpoint(d)
      got = name === 'eof' || name === 'back' ? name : await customModels(d, slot, name)
    }
    if (act.kind === 'remove') got = (await removeEndpoint(d, servers.map((c) => c.name))) === 'eof' ? 'eof' : 'back'
    if (got !== 'back') return got
  }
}

/** A reply as one line, short enough to read at a glance. */
function firstLine(reply: string): string {
  const line = reply.trim().split('\n')[0]
  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

/** Runs setup and returns the exit code: 0 once something answers (SET-12). */
/**
 * SET-32: a question is one line; the blank lines before it are printed.
 * A line editor takes a prompt starting with a newline for two lines tall,
 * and redrawing it moved up and cleared the last line printed: a list of one
 * model showed as none.
 */
function oneLine(ask: SetupIO['ask'], print: SetupIO['print']): SetupIO['ask'] {
  return (prompt) => {
    const lead = prompt.match(/^\n*/)![0].length
    for (let i = 0; i < lead; i++) print('')
    return ask(prompt.slice(lead))
  }
}

export async function runSetup(given: SetupDeps, { check = false } = {}): Promise<number> {
  const d: SetupDeps = { ...given, ask: oneLine(given.ask, given.print), askSecret: oneLine(given.askSecret, given.print) }
  try {
    await d.core.load()
  } catch (e) {
    // Overwriting a file we cannot read would lose whatever was in it (SET-9).
    d.print(`setup: ${e instanceof Error ? e.message : e}. Fix or remove it, then run navi setup again.`)
    return 1
  }

  d.print(dim('Looking for a model…'))
  // Opening setup starts no runtime (SET-24); --check resolves fully, since
  // its exit code says whether navi would answer (SET-2).
  let status = await d.core.status({ launch: check })
  const code = () => (status.answering ? 0 : 1)
  if (check) {
    d.print(describe(status.answering, bold, status))
    if (!status.answering) d.print(CLI_NEXT_STEP)
    return code()
  }
  showStatus(d, status)

  let news: string[] = []
  for (;;) {
    // SET-30: the first screen is the list; b is the backup's, Enter finishes.
    // SET-29: with nothing answering, the way out says what it leaves behind.
    const backup = `a backup, for when the model does not answer (now: ${status.fallback?.label ?? 'none'})`
    const finish = status.answering ? '\nNumber, b for a backup, or Enter to finish: ' : '\nNumber, b for a backup, or Enter to leave without a model: '
    let slot: Slot = 0
    let got = await pick(d, 0, status.primary.label, { b: backup }, finish, news)
    news = []
    if (got === 'b') {
      slot = 1
      got = await pick(d, 1, status.fallback?.label)
      if (got === 'back') continue
    }
    if (got === 'eof' || got === 'back') {
      if (got !== 'eof' && !status.answering) d.print(dim(`\nNo model yet, so navi can't answer. ${CLI_NEXT_STEP}`))
      return code()
    }

    const was = slot === 0 ? status.primary.label : (status.fallback?.label ?? 'none')
    const set = await d.core.setSlot(slot, got)
    status = set.status
    const now = slot === 0 ? status.primary.label : (status.fallback?.label ?? 'none')
    const which = slot === 0 ? 'The model' : 'The backup'
    news = [bold(set.changed ? `${which} is now ${now} (was ${was}).` : `${which} is still ${now}.`)]
    if (!status.answering) {
      showStatus(d, status)
      news = []
      continue
    }
    // Where it answers from stays said: REMOTE is a warning (SET-1).
    news.push(describe(status.answering, bold, status))
    d.print(dim('Asking it a test question…'))
    const t = await d.core.test(status.answering)
    news.push(t.ok ? `It answered the test question: ${firstLine(t.reply)}` : `It didn't answer the test question: ${t.error}`)
  }
}
