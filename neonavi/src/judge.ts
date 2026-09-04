import { generateText, type LanguageModel } from 'ai'

export type Verdict = 'safe' | 'unsafe' | 'unknown'

const SYSTEM = [
  'You decide whether a shell command may run without asking the user.',
  'SAFE means all of: it only reads, or writes new files inside the working',
  'directory without deleting or overwriting existing ones; it sends nothing',
  'over the network; no sudo or privilege change; it kills no processes; it',
  'does not rewrite git history, push, or publish.',
  'Anything else, and anything you cannot tell, is UNSAFE.',
  'Answer with exactly one word on its own line: SAFE or UNSAFE.',
].join(' ')

export function judgePrompt(command: string, intent: string): string {
  return `The user asked: ${JSON.stringify(intent)}\nThe command: ${JSON.stringify(command)}`
}

/** Strict on purpose: a chatty or hedged reply must not read as consent. */
export function parseVerdict(text: string): Verdict {
  let verdict: Verdict = 'unknown'
  for (const line of text.split('\n')) {
    const word = line.trim().replace(/[.*_`]/g, '').toUpperCase()
    if (word === 'SAFE') verdict = 'safe'
    else if (word === 'UNSAFE') verdict = 'unsafe'
  }
  return verdict
}

export async function judge(
  model: LanguageModel,
  command: string,
  intent: string,
): Promise<Verdict> {
  try {
    const { text } = await generateText({
      model,
      system: SYSTEM,
      prompt: judgePrompt(command, intent),
      abortSignal: AbortSignal.timeout(60_000),
    })
    return parseVerdict(text)
  } catch {
    // The caller falls back to asking; a judge that cannot answer changes nothing.
    return 'unknown'
  }
}
