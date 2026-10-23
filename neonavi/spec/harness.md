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
  the turn is stopped declines. A file change (TL-38) goes through the same
  callback: the command is a one-line summary such as `edit src/a.ts (+2 -1)`,
  and the options carry the change itself (path, whether it creates the
  file, and the diff) for a front end that can show it.
- HAR-5: The harness never writes to stdout or stderr itself; everything a user
  might see is an event or a callback, so a front end with no terminal works.
- HAR-6: The CLI is built on the library, with its behaviour in `cli.md`
  unchanged.

## Open

- Serving the harness over MCP or HTTP for jack-ins that cannot import it.
- HAR-7: A turn may carry attachments, files read from disk with the prompt
  (`attach()` reads one). An image (PNG, JPEG, GIF, WebP) is sent to the
  model as an image, scaled down first so its longer side is at most 1600
  pixels where the system can (`sips` on macOS). A PDF is sent as its text,
  headed by its file name. Any other file that reads as UTF-8 text is sent as
  text, headed by its name. Text attachments are cut at 100,000 characters,
  marked. A missing file, a directory, a file over 50 MB, an image still
  over 20 MB once scaled, a PDF with no text layer, or anything else is
  refused with a message naming the file, before any model call.
- HAR-8: Attachments are kept in the history like the prompt they came with.
  For the history's size (SES-8) an image counts as 1,000 tokens, however
  many bytes it holds.
