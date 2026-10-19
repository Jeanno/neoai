import { launchCommand, LaunchType, Toast } from '@raycast/api'

export const NO_MODEL_TITLE = 'Navi has no model to answer with'

/** RAY-7 for the no-view commands: there is no view to offer it in, so open Set Up Navi. */
export async function offerSetUp(toast: Toast, from: string): Promise<void> {
  toast.style = Toast.Style.Failure
  toast.title = NO_MODEL_TITLE
  toast.message = 'Choose one in Set Up Navi.'
  toast.primaryAction = { title: 'Set Up Navi', onAction: () => openSetUp(from) }
  await openSetUp(from)
}

async function openSetUp(from: string) {
  try {
    await launchCommand({ name: 'set-up-navi', type: LaunchType.UserInitiated, context: { from } })
  } catch {
    // The toast still offers it.
  }
}
