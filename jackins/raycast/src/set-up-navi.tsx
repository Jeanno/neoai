import './lib/quiet'
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Keyboard,
  LaunchProps,
  List,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api'
import { useEffect, useRef, useState } from 'react'
import {
  LOCAL_HELP,
  realDeps,
  setupCore,
  type Choice,
  type CustomRow,
  type Group,
  type ModelList,
  type ProviderRow,
  type SetupCore,
  type Slot,
  type Status,
} from 'neonavi/setup'
import { errorMessage } from './lib/model'
import {
  choiceItems,
  isAbort,
  providerAccessory,
  slotItems,
  SLOT_NAME,
  statusMarkdown,
  type TestState,
} from './lib/setup-view'

/**
 * Set Up Navi (RAY-6): setup's core (SET-23) as Raycast views. Every choice,
 * check and write is the core's; nothing is saved until a key or endpoint
 * passes its check or a model is picked, so Escape leaves nothing half-done
 * (SET-12).
 */
const core: SetupCore = setupCore(realDeps())

/** Each pushed view calls this with its pick; it pops itself and passes it on. */
type OnPick = (value: string | null) => void

const GROUP_HINT: Record<Group, string> = {
  providers: 'A hosted model, with your key',
  local: 'A model on this computer',
  custom: 'Any OpenAI-compatible server',
}

const GROUP_ICON: Record<Group, Icon> = { providers: Icon.Globe, local: Icon.Monitor, custom: Icon.Link }

const currentMark = (current: boolean) => (current ? [{ icon: Icon.Checkmark, tooltip: 'Current' }] : [])

/** Hands out a signal per check; leaving the view (Escape) aborts them all (RAY-10, SET-26). */
type Cancel = () => AbortSignal

function useCancel(): Cancel {
  const started = useRef<AbortController[]>([])
  useEffect(
    () => () => {
      for (const c of started.current.splice(0)) c.abort()
    },
    [],
  )
  return () => {
    const c = new AbortController()
    started.current.push(c)
    return c.signal
  }
}

/** A cancelled check's rejection is expected: its view is gone. Anything else still surfaces. */
function unlessAborted(error: unknown) {
  if (!isAbort(error)) throw error
}

export default function Command(props: LaunchProps<{ launchContext?: { from?: string } }>) {
  return <SetUp from={props.launchContext?.from} />
}

/** The slots and what answers now (SET-13), with the test after each change (SET-11). */
export function SetUp({ from }: { from?: string }) {
  const [status, setStatus] = useState<Status>()
  const [broken, setBroken] = useState<string>()
  const [test, setTest] = useState<TestState | null>(null)
  const [busy, setBusy] = useState(false)
  const cancel = useCancel()

  useEffect(() => {
    // A file that is not valid JSON is left alone (SET-9).
    core.load().then(
      // Only servers already running: opening setup starts nothing (SET-24).
      () => core.status({ launch: false, signal: cancel() }).then(setStatus, unlessAborted),
      (error) => setBroken(errorMessage(error)),
    )
  }, [])

  async function picked(slot: Slot, value: string | null) {
    setBusy(true)
    setTest(null)
    try {
      const set = await core.setSlot(slot, value)
      setStatus(set.status)
      if (set.changed) await showToast({ style: Toast.Style.Success, title: 'Saved' })
      if (!set.status.answering) return
      setTest({ state: 'asking' })
      setTest({ state: 'done', ...(await core.test(set.status.answering, { signal: cancel() })) })
    } catch (error) {
      if (isAbort(error)) return
      await showToast({ style: Toast.Style.Failure, title: 'Could not save', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  if (broken)
    return (
      <Detail
        markdown={`## Navi's settings can't be read\n\n${broken}. Fix or remove the file, then open Set Up Navi again.`}
      />
    )

  const intro = from && !status?.answering ? `**${from}** needs a model to answer with.\n\n` : ''
  const markdown = status ? intro + statusMarkdown(status, test) : '_Looking for a model…_'

  return (
    <List navigationTitle="Set Up Navi" isLoading={!status || busy} isShowingDetail>
      {status &&
        slotItems(status).map((item) => (
          <List.Item
            key={item.title}
            title={item.title}
            subtitle={item.subtitle}
            icon={item.answers ? Icon.CheckCircle : Icon.Circle}
            accessories={item.answers ? [{ tag: 'answers now' }] : []}
            detail={<List.Item.Detail markdown={`**${item.title}:** ${item.subtitle}\n\n${markdown}`} />}
            actions={
              item.slot === null ? undefined : (
                <ActionPanel>
                  <Action.Push
                    title={`Change ${SLOT_NAME[item.slot]} Model`}
                    icon={Icon.Pencil}
                    target={<SlotMenu slot={item.slot} onPick={(v) => picked(item.slot as Slot, v)} />}
                  />
                </ActionPanel>
              )
            }
          />
        ))}
    </List>
  )
}

/** SET-18: Providers, Local or Custom; the fallback also offers none. */
function SlotMenu({ slot, onPick }: { slot: Slot; onPick: OnPick }) {
  const { pop } = useNavigation()
  const pick: OnPick = (v) => {
    pop()
    onPick(v)
  }
  const [menu, setMenu] = useState<Awaited<ReturnType<SetupCore['slotMenu']>>>()

  useEffect(() => {
    core.slotMenu(slot).then(setMenu)
  }, [])

  const target = (g: Group) =>
    g === 'providers' ? (
      <Providers slot={slot} onPick={pick} />
    ) : g === 'local' ? (
      <Local slot={slot} onPick={pick} />
    ) : (
      <Custom slot={slot} onPick={pick} />
    )

  return (
    <List navigationTitle={`${SLOT_NAME[slot]} Model`} isLoading={!menu}>
      {menu?.groups.map((g) => (
        <List.Item
          key={g.id}
          title={g.label}
          subtitle={GROUP_HINT[g.id]}
          icon={GROUP_ICON[g.id]}
          actions={
            <ActionPanel>
              <Action.Push title={`Open ${g.label}`} icon={Icon.ArrowRight} target={target(g.id)} />
            </ActionPanel>
          }
        />
      ))}
      {menu?.none && (
        <List.Item
          title="None"
          subtitle="No fallback"
          icon={Icon.XMarkCircle}
          accessories={currentMark(menu.none.current)}
          actions={
            <ActionPanel>
              <Action title="Use No Fallback" icon={Icon.Check} onAction={() => pick(null)} />
            </ActionPanel>
          }
        />
      )}
    </List>
  )
}

/** Model choices as rows; picking one passes its link up. */
function ChoiceRows({ choices, onPick }: { choices: Choice[]; onPick: OnPick }) {
  return (
    <>
      {choiceItems(choices).map((c) => (
        <List.Item
          key={c.id}
          title={c.title}
          subtitle={c.subtitle}
          icon={Icon.ComputerChip}
          accessories={currentMark(c.current)}
          actions={
            <ActionPanel>
              <Action title="Use Model" icon={Icon.Check} onAction={() => onPick(c.value)} />
            </ActionPanel>
          }
        />
      ))}
    </>
  )
}

/** A long list, searchable with Raycast's own search bar. */
function AllModels({ title, choices, onPick }: { title: string; choices: Choice[]; onPick: OnPick }) {
  const { pop } = useNavigation()
  const pick: OnPick = (v) => {
    pop()
    onPick(v)
  }
  return (
    <List navigationTitle={title} searchBarPlaceholder="Search models…">
      <ChoiceRows choices={choices} onPick={pick} />
    </List>
  )
}

/** SET-19 */
function Providers({ slot, onPick }: { slot: Slot; onPick: OnPick }) {
  const { pop, push } = useNavigation()
  const pick: OnPick = (v) => {
    pop()
    onPick(v)
  }
  const [rows, setRows] = useState<ProviderRow[]>()
  const reload = () => core.providers().then(setRows)

  useEffect(() => {
    reload()
  }, [])

  const models = (p: ProviderRow) => <ProviderModels slot={slot} provider={p} onPick={pick} />

  return (
    <List navigationTitle="Providers" isLoading={!rows}>
      {rows?.map((p) => {
        const key = (
          <KeyForm
            provider={p}
            onSaved={() => {
              reload()
              push(models(p))
            }}
          />
        )
        const note = providerAccessory(p)
        return (
          <List.Item
            key={p.id}
            title={p.name}
            icon={p.key ? Icon.Key : Icon.Globe}
            accessories={note ? [{ text: note }] : []}
            actions={
              <ActionPanel>
                {p.key ? (
                  <Action.Push title="Choose Model" icon={Icon.ArrowRight} target={models(p)} />
                ) : (
                  <Action.Push title="Enter Key" icon={Icon.Key} target={key} />
                )}
                {p.key && <Action.Push title="Replace Key" icon={Icon.Key} target={key} />}
                <Action.OpenInBrowser title="Open Key Page" url={p.keyPage} />
              </ActionPanel>
            }
          />
        )
      })}
    </List>
  )
}

/** SET-6: a key in a password field, checked with the provider before it is saved. */
function KeyForm({ provider: p, onSaved }: { provider: ProviderRow; onSaved: () => void }) {
  const { pop } = useNavigation()
  const [error, setError] = useState<string>()
  const [checking, setChecking] = useState(false)
  const cancel = useCancel()

  async function submit({ key }: { key: string }) {
    if (!key.trim()) return setError('Paste a key first.')
    setChecking(true)
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Checking the key…' })
    let saved: Awaited<ReturnType<SetupCore['saveKey']>>
    try {
      saved = await core.saveKey(p.id, key, { signal: cancel() })
    } catch (error) {
      // Left before the check finished: nothing was saved (SET-26).
      if (!isAbort(error)) throw error
      await toast.hide()
      return
    }
    setChecking(false)
    if (!saved.ok) {
      toast.style = Toast.Style.Failure
      toast.title = saved.why === 'rejected' ? 'Key not accepted' : 'Key not saved'
      toast.message = saved.message
      setError(saved.message)
      return
    }
    toast.style = Toast.Style.Success
    toast.title = 'Key saved'
    pop()
    onSaved()
  }

  return (
    <Form
      navigationTitle={`${p.name} Key`}
      isLoading={checking}
      searchBarAccessory={<Form.LinkAccessory target={p.keyPage} text="Get a Key" />}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Check and Save Key" icon={Icon.Key} onSubmit={submit} />
          <Action.OpenInBrowser title="Open Key Page" url={p.keyPage} />
        </ActionPanel>
      }
    >
      <Form.Description
        text={`Create a key at ${p.keyPage}, then paste it here. It is checked with ${p.name} before it is saved.`}
      />
      {p.key === 'env' && (
        <Form.Description text={`${p.env} is set in your environment; it is used instead of a saved key.`} />
      )}
      <Form.PasswordField id="key" title="Key" error={error} onChange={() => setError(undefined)} />
    </Form>
  )
}

/** SET-20: the hand-picked models still on offer, then "All models…". */
function ProviderModels({ slot, provider: p, onPick }: { slot: Slot; provider: ProviderRow; onPick: OnPick }) {
  const { pop } = useNavigation()
  const pick: OnPick = (v) => {
    pop()
    onPick(v)
  }
  const [list, setList] = useState<ModelList>()
  const cancel = useCancel()
  const load = () => {
    setList(undefined)
    core.providerModels(p.id, slot, { signal: cancel() }).then(setList, unlessAborted)
  }

  useEffect(() => {
    load()
  }, [])

  const replaceKey = (
    <Action.Push title="Replace Key" icon={Icon.Key} target={<KeyForm provider={p} onSaved={load} />} />
  )

  if (list && !list.ok)
    return (
      <List navigationTitle={p.name}>
        <List.EmptyView
          icon={Icon.Warning}
          title={list.message}
          actions={
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={load} />
              {replaceKey}
            </ActionPanel>
          }
        />
      </List>
    )

  return (
    <List navigationTitle={p.name} isLoading={!list}>
      {list?.ok && (
        <>
          <List.Section title="Recommended">
            <ChoiceRows choices={list.recommended} onPick={pick} />
          </List.Section>
          <List.Section>
            <List.Item
              title="All Models…"
              icon={Icon.List}
              accessories={[{ text: `${list.all.length}` }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="All Models"
                    icon={Icon.List}
                    target={<AllModels title={`All ${p.name} Models`} choices={list.all} onPick={pick} />}
                  />
                  {replaceKey}
                </ActionPanel>
              }
            />
          </List.Section>
        </>
      )}
    </List>
  )
}

/** SET-21: the models on running local servers, by id (SET-25), with help and Check Again (SET-5). */
function Local({ slot, onPick }: { slot: Slot; onPick: OnPick }) {
  const { pop } = useNavigation()
  const pick: OnPick = (v) => {
    pop()
    onPick(v)
  }
  const [choices, setChoices] = useState<Choice[]>()
  const cancel = useCancel()
  const load = () => {
    setChoices(undefined)
    core.localModels(slot, { signal: cancel() }).then(setChoices, unlessAborted)
  }

  useEffect(() => {
    load()
  }, [])

  const running = choices?.some((c) => c.value !== 'local')
  const help = <LocalHelp onFound={load} />
  const checkAgain = <CheckAgain cancel={cancel} onFound={load} />

  return (
    <List navigationTitle="Local" isLoading={!choices}>
      {choices && (
        <List.Section title={running ? 'On This Computer' : 'On This Computer (nothing running)'}>
          {choiceItems(choices).map((c) => (
            <List.Item
              key={c.id}
              title={c.title}
              icon={Icon.ComputerChip}
              accessories={currentMark(c.current)}
              actions={
                <ActionPanel>
                  <Action title="Use Model" icon={Icon.Check} onAction={() => pick(c.value)} />
                  {checkAgain}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
      <List.Section>
        <List.Item
          title="Help Getting a Model"
          icon={Icon.QuestionMarkCircle}
          actions={
            <ActionPanel>
              <Action.Push title="Help Getting a Model" icon={Icon.QuestionMarkCircle} target={help} />
              {checkAgain}
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  )
}

/**
 * Looks for a local model again: a probe, which also starts an installed
 * runtime (SET-5). `cancel` is the view's, so leaving it stops the look (RAY-10).
 */
function CheckAgain({ cancel, onFound }: { cancel: Cancel; onFound: (found: boolean) => void }) {
  async function check() {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Looking for a local model…' })
    let found: Awaited<ReturnType<SetupCore['recheckLocal']>>
    try {
      found = await core.recheckLocal({ signal: cancel() })
    } catch (error) {
      if (!isAbort(error)) throw error
      await toast.hide()
      return
    }
    if (found) {
      toast.style = Toast.Style.Success
      toast.title = `Found ${found.label}`
    } else {
      toast.style = Toast.Style.Failure
      toast.title = 'Nothing yet'
      toast.message = 'Is a model downloaded, and (in LM Studio) is the server on?'
    }
    onFound(!!found)
  }
  return (
    <Action
      title="Check Again"
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={check}
    />
  )
}

const HELP = [
  '## Get a model on this computer',
  'Install one of these; navi finds either one by itself.',
  ...LOCAL_HELP.map((h) => `### [${h.name}](${h.url})\n\n${h.steps}`),
  'Then choose **Check Again**.',
].join('\n\n')

function LocalHelp({ onFound }: { onFound: () => void }) {
  const { pop } = useNavigation()
  const cancel = useCancel()
  return (
    <Detail
      navigationTitle="Help Getting a Model"
      markdown={HELP}
      actions={
        <ActionPanel>
          <CheckAgain
            cancel={cancel}
            onFound={(found) => {
              if (!found) return
              pop()
              onFound()
            }}
          />
          {LOCAL_HELP.map((h) => (
            <Action.OpenInBrowser key={h.name} title={`Open ${h.name} Website`} url={h.url} />
          ))}
        </ActionPanel>
      }
    />
  )
}

/** SET-22: saved endpoints, and adding one. */
function Custom({ slot, onPick }: { slot: Slot; onPick: OnPick }) {
  const { pop, push } = useNavigation()
  const pick: OnPick = (v) => {
    pop()
    onPick(v)
  }
  const [rows, setRows] = useState<CustomRow[]>()
  const reload = () => core.customs().then(setRows)

  useEffect(() => {
    reload()
  }, [])

  const models = (name: string) => <CustomModels slot={slot} name={name} onPick={pick} />
  const add = (
    <Action.Push
      title="Add Endpoint"
      icon={Icon.Plus}
      target={
        <AddEndpoint
          onSaved={(name) => {
            reload()
            push(models(name))
          }}
        />
      }
    />
  )

  return (
    <List navigationTitle="Custom" isLoading={!rows}>
      {rows?.map((c) => (
        <List.Item
          key={c.name}
          title={c.name}
          subtitle={c.baseURL}
          icon={Icon.Link}
          accessories={c.hasKey ? [{ icon: Icon.Key, tooltip: 'Has a key' }] : []}
          actions={
            <ActionPanel>
              <Action.Push title="Choose Model" icon={Icon.ArrowRight} target={models(c.name)} />
              {add}
            </ActionPanel>
          }
        />
      ))}
      <List.Item
        title="Add Endpoint"
        subtitle="Any OpenAI-compatible server"
        icon={Icon.Plus}
        actions={<ActionPanel>{add}</ActionPanel>}
      />
    </List>
  )
}

function CustomModels({ slot, name, onPick }: { slot: Slot; name: string; onPick: OnPick }) {
  const { pop } = useNavigation()
  const [list, setList] = useState<ModelList>()
  const cancel = useCancel()
  const load = () => {
    setList(undefined)
    core.customModels(name, slot, { signal: cancel() }).then(setList, unlessAborted)
  }

  useEffect(() => {
    load()
  }, [])

  if (list && !list.ok)
    return (
      <List navigationTitle={name}>
        <List.EmptyView
          icon={Icon.Warning}
          title={list.message}
          actions={
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={load} />
            </ActionPanel>
          }
        />
      </List>
    )

  return (
    <List navigationTitle={name} isLoading={!list} searchBarPlaceholder="Search models…">
      {list?.ok && (
        <ChoiceRows
          choices={list.all}
          onPick={(v) => {
            pop()
            onPick(v)
          }}
        />
      )}
    </List>
  )
}

/** SET-22: a name, a base URL and an optional key, checked by listing the server's models. */
function AddEndpoint({ onSaved }: { onSaved: (name: string) => void }) {
  const { pop } = useNavigation()
  const [nameError, setNameError] = useState<string>()
  const [checking, setChecking] = useState(false)
  const cancel = useCancel()

  async function submit(v: { name: string; baseURL: string; key: string }) {
    const bad = core.checkCustomName(v.name)
    if (bad) return setNameError(bad)
    setChecking(true)
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Checking the endpoint…' })
    let added: Awaited<ReturnType<SetupCore['addCustom']>>
    try {
      added = await core.addCustom({ name: v.name, baseURL: v.baseURL, key: v.key }, { signal: cancel() })
    } catch (error) {
      // Left before the check finished: nothing was saved (SET-26).
      if (!isAbort(error)) throw error
      await toast.hide()
      return
    }
    setChecking(false)
    if (!added.ok) {
      toast.style = Toast.Style.Failure
      toast.title = 'Endpoint not saved'
      toast.message = added.message
      return
    }
    toast.style = Toast.Style.Success
    toast.title = `Saved ${v.name.trim()}`
    toast.message = added.baseURL
    pop()
    onSaved(v.name.trim())
  }

  return (
    <Form
      navigationTitle="Add Endpoint"
      isLoading={checking}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Check and Save Endpoint" icon={Icon.Plus} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Any OpenAI-compatible server. It is checked by listing its models before it is saved." />
      <Form.TextField
        id="name"
        title="Name"
        placeholder="homelab"
        error={nameError}
        onChange={() => setNameError(undefined)}
        onBlur={(e) => setNameError(e.target.value ? (core.checkCustomName(e.target.value) ?? undefined) : undefined)}
      />
      <Form.TextField id="baseURL" title="Base URL" placeholder="http://my-server:8000/v1" />
      <Form.PasswordField id="key" title="Key" placeholder="Optional" />
    </Form>
  )
}
