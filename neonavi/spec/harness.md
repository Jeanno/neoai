# Harness

navi's harness is everything between a prompt and an answer: the system prompt
(`prompt.md`), NAVI.md context (`context.md`), the tools and shell approval
(`tools.md`), compaction, and the step loop. The CLI is one front end to it;
jack-ins are others (`jackins/NAVI.md`).

## Library

- HAR-1: The harness is importable as `neonavi/harness`. A front end supplies
  the model, the working directory and how to ask the user about a shell
  command; the harness supplies everything else, so every front end gets the
  same prompt, tools, judge and limits.
- HAR-2: A session is created once per conversation and holds its history. Each
  turn takes a prompt and streams events: text as it arrives, each tool call
  when it starts, each tool result, and the end of the turn with the new
  history. A turn can be stopped; what was said so far is kept.
- HAR-3: A front end may start a session from an existing history, so it can
  store conversations its own way (the CLI per directory, Raycast in its own
  storage).
- HAR-4: Shell approval goes through the front end's callback with the command;
  the judge (TL-18 to TL-25) runs first, so the callback is only asked about
  commands not judged safe. A callback that throws or is never answered before
  the turn is stopped declines.
- HAR-5: The harness never writes to stdout or stderr itself; everything a user
  might see is an event or a callback, so a front end with no terminal works.
- HAR-6: The CLI is built on the library, with its behaviour in `cli.md`
  unchanged.

## Open

- Serving the harness over MCP or HTTP for jack-ins that cannot import it.
