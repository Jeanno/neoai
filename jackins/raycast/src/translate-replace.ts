import { getPreferenceValues } from '@raycast/api'
import { replaceSelection } from './lib/replace-selection'
import { translatePrompt } from './lib/rewrite'

export default async function Command() {
  const language = getPreferenceValues<Preferences>().language?.trim() || 'English'
  await replaceSelection({
    command: 'Translate and Replace',
    working: 'Translating…',
    done: `Translated to ${language}`,
    failed: 'Could not translate the text',
    build: (text) => translatePrompt(text, language),
  })
}
