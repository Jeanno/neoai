import { Action, ActionPanel, Detail, Icon } from '@raycast/api'
import { SetUp } from './set-up-navi'
import { NEXT_STEP } from 'neonavi/setup'
import { NO_MODEL_TITLE } from './lib/offer-set-up'
import { whyNoModel } from './lib/model'
import type { Approval } from './lib/approval'

// The core's next step (SET-27), why each link failed (MOD-21), then how to
// take the step here (RAY-7).
const noModel = (why: string) => `## ${NO_MODEL_TITLE}

${NEXT_STEP}
${why && `\n${why}\n`}
Press Return to open **Set Up Navi**.`

/** RAY-7: what every view shows when no model answers, with Set Up Navi first. */
export function NoModel({ onDone }: { onDone: () => void }) {
  return (
    <Detail
      markdown={noModel(whyNoModel())}
      actions={
        <ActionPanel>
          <SetUpAction onDone={onDone} />
        </ActionPanel>
      }
    />
  )
}

/** Opens Set Up Navi over the current view; `onDone` runs when it is left, to look again. */
export function SetUpAction({ onDone }: { onDone: () => void }) {
  // The command's own name, as Raycast lists it.
  // eslint-disable-next-line @raycast/prefer-title-case
  return <Action.Push title="Set Up Navi" icon={Icon.Gear} target={<SetUp />} onPop={onDone} />
}

/** RAY-3: the command or file change waiting for approval, as the first actions in the panel. */
export function ApprovalSection({ approval }: { approval: Approval }) {
  const file = !!approval.change
  return (
    <ActionPanel.Section title={file ? 'Make this change?' : 'Run this command?'}>
      <Action
        title={file ? 'Write File' : 'Run Command'}
        icon={file ? Icon.Document : Icon.Terminal}
        onAction={() => approval.answer(true)}
      />
      <Action
        title={file ? "Don't Write" : "Don't Run"}
        icon={Icon.XMarkCircle}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ['cmd'], key: 'd' }}
        onAction={() => approval.answer(false)}
      />
    </ActionPanel.Section>
  )
}
