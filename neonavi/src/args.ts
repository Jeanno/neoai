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
 * Without this the model guesses at absolute paths like /usr/src and burns the
 * whole step budget looking for a directory that was under its nose.
 */
export function systemPrompt(cwd: string): string {
  return [
    'You are navi, a command-line assistant.',
    `You are running in ${cwd}. Paths you pass to tools are relative to that directory unless absolute.`,
    'Use list_dir and read_file to look around before answering.',
    'run_shell asks the user for approval every time; if they decline, do not retry the same command.',
    'When you have the answer, state it plainly. Do not narrate your tool use.',
  ].join('\n')
}
