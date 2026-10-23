import { Detail, getSelectedFinderItems, LaunchProps } from '@raycast/api'
import { attach, type Attachment } from 'neonavi/harness'
import { useEffect, useState } from 'react'
import { Answer } from './ask-ai'

type Picked = { attachments: Attachment[] } | { problem: string }

/** The Finder selection, read for a turn (RAY-11), or what stops it. */
async function pick(): Promise<Picked> {
  const items = await getSelectedFinderItems().catch(() => [])
  if (!items.length) return { problem: 'Select one or more files in Finder, then run this again.' }
  const attachments: Attachment[] = []
  const refused: string[] = []
  for (const { path } of items) {
    try {
      attachments.push(await attach(path))
    } catch (error) {
      refused.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (refused.length)
    return { problem: `Navi can't read every file selected:\n\n${refused.map((r) => `- ${r}`).join('\n')}` }
  return { attachments }
}

export default function Command(props: LaunchProps<{ arguments: Arguments.AskFiles }>) {
  const question = (props.arguments.prompt || '').trim() || 'Describe these files.'
  const [picked, setPicked] = useState<Picked>()
  useEffect(() => {
    pick().then(setPicked)
  }, [])
  if (!picked) return <Detail isLoading markdown="Reading the selected files…" />
  if ('problem' in picked) return <Detail markdown={`## Nothing to ask about\n\n${picked.problem}`} />
  return <Answer question={question} attachments={picked.attachments} />
}
