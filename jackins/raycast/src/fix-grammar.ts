import { replaceSelection } from './lib/replace-selection'
import { fixPrompt } from './lib/rewrite'

export default async function Command() {
  await replaceSelection({ working: 'Fixing…', done: 'Fixed', failed: 'Could not fix the text', build: fixPrompt })
}
