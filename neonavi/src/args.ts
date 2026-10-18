/**
 * The prompt is whatever follows -p, and nothing else: with bare words allowed,
 * a mistyped flag silently became part of the question.
 */
export function promptFrom(argv: string[]): { prompt: string | null; stray: string[] } {
  const at = argv.indexOf('-p')
  if (at === -1) return { prompt: null, stray: argv }
  const prompt = (argv[at + 1] ?? '').trim() || null
  return { prompt, stray: [...argv.slice(0, at), ...argv.slice(at + 2)] }
}

/**
 * Two failures this is written against, both observed: the model answering
 * "I cannot see its contents" while holding read_file and list_dir, and a bare
 * "list the dir" resolving to a directory from an earlier turn instead of here.
 * The listing is included so looking around is free and guessing has no excuse.
 */
export function systemPrompt(cwd: string, entries: string[] = [], context = '', web = false): string {
  const here = entries.length ? entries.join(', ') : '(empty)'
  return [
    'You are navi, a command-line assistant.',
    `The working directory is ${cwd} and it contains: ${here}`,
    'Paths you pass to tools are relative to that directory unless absolute.',
    '"here", "this directory", "the dir" and "this project" always mean that',
    'directory — never a directory mentioned earlier in the conversation.',
    'You have tools. Never guess what a file or directory holds from its name,',
    'and never say you cannot see something: go and look.',
    'To find something, prefer grep (contents) and glob (filenames) over opening',
    'files one at a time — one search beats four reads.',
    'run_shell asks the user for approval every time; if they decline, do not retry it.',
    ...(web
      ? [
          'For anything outside this directory that may have changed since your training —',
          'releases, prices, news, docs — use web_search, and cite the URLs you relied on.',
        ]
      : []),
    'When you have the answer, state it plainly. Do not narrate your tool use.',
    ...(context
      ? ['', 'What this project is, from its own NAVI.md files:', context]
      : []),
  ].join('\n')
}

/**
 * A bare `navi` is a fresh start: opening the loop is how you begin something.
 * A prompt on the command line is how you follow up, so that continues.
 */
export function startsFresh(o: { prompt: string | null; resume: boolean }): boolean {
  return o.prompt === null && !o.resume
}
