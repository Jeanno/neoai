import { Clipboard, closeMainWindow, getSelectedText, showHUD, showToast, Toast } from '@raycast/api'
import { generateText } from 'ai'
import { errorMessage, resolveNavi } from './model'
import { offerSetUp } from './offer-set-up'
import { cleanOutput, keepSurroundingWhitespace, type Prompt } from './rewrite'

/**
 * Reads the selection, has the model rewrite it, and pastes the result over
 * it. The model is called directly, without the harness's tools: these only
 * rewrite text (RAY-5).
 */
export async function replaceSelection(task: {
  /** The command's title, for Set Up Navi to name when there is no model. */
  command: string
  working: string
  done: string
  failed: string
  build: (text: string) => Prompt
}): Promise<void> {
  let selected = ''
  try {
    selected = await getSelectedText()
  } catch {
    // Rejected when nothing is selected, or the app does not expose its selection.
  }
  if (!selected.trim()) {
    await showToast({ style: Toast.Style.Failure, title: 'No text selected', message: 'Select some text first.' })
    return
  }

  const toast = await showToast({ style: Toast.Style.Animated, title: task.working })
  try {
    const navi = await resolveNavi()
    if (!navi) return await offerSetUp(toast, task.command)
    const { system, prompt } = task.build(selected)
    const { text } = await generateText({ model: navi.model, system, prompt })
    const result = cleanOutput(text, selected)
    if (!result) throw new Error('The model returned no text.')
    await closeMainWindow()
    await Clipboard.paste(keepSurroundingWhitespace(selected, result))
    await showHUD(task.done)
  } catch (error) {
    toast.style = Toast.Style.Failure
    toast.title = task.failed
    toast.message = errorMessage(error)
  }
}
