import { replaceSelection } from './lib/replace-selection'
import { fixPrompt } from './lib/rewrite'

export default async function Command() {
  await replaceSelection({
    command: 'Fix Spelling and Grammar',
    working: 'Fixing…',
    done: 'Fixed',
    failed: 'Could not fix the text',
    build: fixPrompt,
  })
}
