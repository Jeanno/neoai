import { Clipboard, closeMainWindow, getSelectedText, showHUD, showToast, Toast } from '@raycast/api'
import { generateText } from 'ai'
import { errorMessage, resolveNavi } from './model'
import { cleanOutput, keepSurroundingWhitespace, type Prompt } from './rewrite'

/** Reads the selection, has the model rewrite it, and pastes the result over it. */
export async function replaceSelection(task: {
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
    const { llm } = await resolveNavi()
    const { system, prompt } = task.build(selected)
    const { text } = await generateText({ model: llm, system, prompt })
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
