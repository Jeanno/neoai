import { Action, ActionPanel, Clipboard, Color, Icon, List, showToast, Toast } from '@raycast/api'
import { useCallback, useEffect, useState } from 'react'
import { actionsFor, detailOf, jobsClient, NotServing, sections, statusWord, type JobRow } from './lib/jobs'

const client = jobsClient()

const ICONS: Record<string, { source: Icon; tintColor: Color }> = {
  waiting: { source: Icon.QuestionMarkCircle, tintColor: Color.Orange },
  running: { source: Icon.CircleProgress50, tintColor: Color.Blue },
  queued: { source: Icon.Clock, tintColor: Color.SecondaryText },
  done: { source: Icon.CheckCircle, tintColor: Color.Green },
  failed: { source: Icon.XMarkCircle, tintColor: Color.Red },
  stopped: { source: Icon.StopFilled, tintColor: Color.SecondaryText },
  interrupted: { source: Icon.ExclamationMark, tintColor: Color.Yellow },
}

/** navi serve's jobs, followed while the list is open (RAY-15 to RAY-17). */
export default function Command() {
  const [jobs, setJobs] = useState<JobRow[]>()
  const [down, setDown] = useState(false)
  const [text, setText] = useState('')

  const reload = useCallback(async () => {
    try {
      setJobs(await client.list())
      setDown(false)
    } catch (e) {
      if (e instanceof NotServing) setDown(true)
      else await showToast({ style: Toast.Style.Failure, title: 'Could not list jobs', message: String((e as Error).message) })
    }
  }, [])

  useEffect(() => {
    reload()
    const timer = setInterval(reload, 2000)
    return () => clearInterval(timer)
  }, [reload])

  async function act(title: string, run: () => Promise<unknown>) {
    const toast = await showToast({ style: Toast.Style.Animated, title })
    try {
      await run()
      toast.style = Toast.Style.Success
    } catch (e) {
      toast.style = Toast.Style.Failure
      toast.message = (e as Error).message
    }
    await reload()
  }

  const prompt = text.trim()
  const startJob = prompt ? (
    <Action
      title="Start Job"
      icon={Icon.Play}
      shortcut={{ modifiers: ['cmd'], key: 'return' }}
      onAction={() =>
        act('Starting job…', async () => {
          await client.start(prompt)
          setText('')
        })
      }
    />
  ) : null

  if (down)
    return (
      <List>
        <List.EmptyView
          icon={Icon.Plug}
          title="navi serve is not running"
          description="Jobs run in navi serve. Start it, and keep it running, with navi serve --install."
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Command" content="navi serve --install" />
            </ActionPanel>
          }
        />
      </List>
    )

  return (
    <List
      isLoading={jobs === undefined}
      isShowingDetail={!!jobs?.length}
      filtering={false}
      searchText={text}
      onSearchTextChange={setText}
      searchBarPlaceholder="Type a job to start, then ⌘↵"
    >
      <List.EmptyView
        icon={Icon.Tray}
        title={prompt ? 'Start this job with ⌘↵' : 'No jobs yet'}
        description={prompt ? 'It runs in navi serve, and asks before it changes anything.' : 'Type what navi should do, then press ⌘↵.'}
        actions={startJob ? <ActionPanel>{startJob}</ActionPanel> : undefined}
      />
      {sections(jobs ?? []).map((s) => (
        <List.Section key={s.title} title={s.title}>
          {s.jobs.map((j) => {
            const can = actionsFor(j)
            return (
              <List.Item
                key={j.id}
                title={j.prompt.split('\n')[0]}
                icon={ICONS[j.status] ?? Icon.Circle}
                accessories={[{ text: statusWord(j) }, { date: new Date(j.updated ?? j.created) }]}
                detail={<List.Item.Detail markdown={detailOf(j)} />}
                actions={
                  <ActionPanel>
                    {can.allow && (
                      <>
                        <Action title="Allow" icon={Icon.Check} shortcut={{ modifiers: ['opt'], key: 'y' }} onAction={() => act('Allowing…', () => client.answer(j.id, true))} />
                        <Action title="Deny" icon={Icon.XMarkCircle} shortcut={{ modifiers: ['opt'], key: 'n' }} onAction={() => act('Denying…', () => client.answer(j.id, false))} />
                      </>
                    )}
                    {can.copy && <Action title="Copy Answer" icon={Icon.Clipboard} onAction={() => Clipboard.copy(j.answer!).then(() => showToast({ title: 'Copied answer' }))} />}
                    {can.retry && <Action title="Try Again" icon={Icon.RotateClockwise} shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }} onAction={() => act('Trying again…', () => client.retry(j.id))} />}
                    {startJob}
                    {can.stop && (
                      <Action title="Stop Job" icon={Icon.Stop} style={Action.Style.Destructive} shortcut={{ modifiers: ['ctrl'], key: 'x' }} onAction={() => act('Stopping…', () => client.stop(j.id))} />
                    )}
                  </ActionPanel>
                }
              />
            )
          })}
        </List.Section>
      ))}
    </List>
  )
}
