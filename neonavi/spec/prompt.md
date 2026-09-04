# System prompt

Rebuilt at startup and sent with every turn.

- PRM-1: Names the working directory and lists its top-level entries, so
  looking around costs nothing and guessing has no excuse.
- PRM-2: States that tool paths are relative to that directory unless absolute.
- PRM-3: Pins "here", "this directory", "the dir" and "this project" to the
  working directory, never to a directory from an earlier turn.
- PRM-4: Forbids guessing a file's contents from its name and forbids claiming
  it cannot see something.
- PRM-5: Steers toward grep and glob before opening files one at a time.
- PRM-6: States that run_shell asks the user every time and must not be
  retried after a decline.
- PRM-7: Asks for a plain answer without narration of tool use.
- PRM-8: Appends the collected NAVI.md context (see context.md) when there is
  any, under a heading that says where it came from.
