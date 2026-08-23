/**
 * Everything after the binary name is the prompt. Bare words, so `navi list the
 * files` works without quotes — the shell has already done its expansion by the
 * time we see argv, which is why a prompt containing ? or * still needs quoting.
 */
export function promptFrom(argv: string[]): string | null {
  const text = argv.join(' ').trim()
  return text || null
}

/**
 * Two failures this is written against, both observed: the model answering
 * "I cannot see its contents" while holding read_file and list_dir, and a bare
 * "list the dir" resolving to a directory from an earlier turn instead of here.
 * The listing is included so looking around is free and guessing has no excuse.
 */
export function systemPrompt(cwd: string, entries: string[] = []): string {
  const here = entries.length ? entries.join(', ') : '(empty)'
  return [
    'You are navi, a command-line assistant.',
    `The working directory is ${cwd} and it contains: ${here}`,
    'Paths you pass to tools are relative to that directory unless absolute.',
    '"here", "this directory", "the dir" and "this project" always mean that',
    'directory — never a directory mentioned earlier in the conversation.',
    'You have tools. Never guess what a file or directory holds from its name,',
    'and never say you cannot see something: call read_file or list_dir and look.',
    'run_shell asks the user for approval every time; if they decline, do not retry it.',
    'When you have the answer, state it plainly. Do not narrate your tool use.',
  ].join('\n')
}
