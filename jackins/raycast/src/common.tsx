import { Action, ActionPanel, Detail, Icon } from '@raycast/api'
import { SetUp } from './set-up-navi'
import { NO_MODEL_TITLE } from './lib/offer-set-up'
import type { Approval } from './lib/approval'

const NO_MODEL = `## ${NO_MODEL_TITLE}

Choose one in **Set Up Navi**: a model on this computer, a provider with your
key, or your own endpoint. Press Return to open it.`

/** RAY-7: what every view shows when no model answers, with Set Up Navi first. */
export function NoModel({ onDone }: { onDone: () => void }) {
  return (
    <Detail
      markdown={NO_MODEL}
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

/** RAY-3: the command waiting for approval, as the first actions in the panel. */
export function ApprovalSection({ approval }: { approval: Approval }) {
  return (
    <ActionPanel.Section title="Run this command?">
      <Action title="Run Command" icon={Icon.Terminal} onAction={() => approval.answer(true)} />
      <Action
        title="Don't Run"
        icon={Icon.XMarkCircle}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ['cmd'], key: 'd' }}
        onAction={() => approval.answer(false)}
      />
    </ActionPanel.Section>
  )
}
