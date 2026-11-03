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
  file, and the diff) for a front end that can show it. A callback may answer
  `'always'` for a command: it runs, and is allowed from then on (TL-43). A
  browser action (BRW-11) goes through it too, judged first by the browser's
  rules: the command is its one-line description and the options carry the
  page's URL; it is never remembered, so `'always'` is a plain yes.
- HAR-9: A front end that wants the browser tools passes a way to make a
  tab (`makeTab` from `neonavi/browser`); the harness makes one per session
  on first use. Without it there are no browser tools, and Playwright is
  never loaded.
- HAR-10: A front end names itself and the model it gives (LED-1), and may
  give a way to resolve the escalation model (ESC-1); the harness keeps the
  ledger and escalates, so every front end does both the same way. A
  harness made without a front end's name keeps no ledger.
- HAR-11: An answer that ended because the model reached its token cap
  (`maxTokens`, MOD-24, or the server's own), not because it was finished,
  is marked `cut` on `done`; a stopped or escalated one is not. The CLI says
  so after it, a job in its log, Raycast as a note, all in the same words
  and saying how to go on, and the ledger keeps `cut` (LED-1).
- HAR-12: A turn that used tools and whose answer ends by saying what the
  model will do next, without doing it ("Now I'll submit the
  application.") or trails off ("Sending application..."), is carried on once: the model is told it stopped after
  saying what it would do, and to go on and do it. Its answer is then both
  parts. A closing offer ("Let me know if…", "I'll be here"), a question,
  a turn without tools, and one stopped, cut or escalated are not carried
  on, nor is a turn twice.
- HAR-5: The harness never writes to stdout or stderr itself; everything a user
  might see is an event or a callback, so a front end with no terminal works.
- HAR-6: The CLI is built on the library, with its behaviour in `cli.md`
  unchanged.

## Attachments

- HAR-7: A turn may carry attachments, files read from disk with the prompt
  (`attach()` reads one). An image (PNG, JPEG, GIF, WebP) is sent to the model
  as an image, scaled down first so its longer side is at most 1600 pixels
  where the system can (`sips` on macOS). A PDF is sent as its text, headed by
  its file name. A PDF with no text layer is scanned pages: where the system
  can draw them (PDFKit on macOS), its first 8 pages are sent as JPEG images
  at most 1600 pixels on a side (smaller where a page would pass 4 MB, and
  fewer pages where they would pass 20 MB together), and the model is told how
  many of how many it sees. Any other file that reads as UTF-8 text is sent as
  text, headed by its name. Text attachments are cut at 100,000 characters,
  marked. A missing file, a directory, a file over 50 MB, an image still over
  20 MB once scaled, a PDF with no text whose pages cannot be drawn, or
  anything else is refused with a message naming the file, before any model
  call.
- HAR-8: Attachments are kept in the history like the prompt they came with.
  For the history's size (SES-8) an image counts as 1,000 tokens, however
  many bytes it holds.

## Open

- Jack-ins that cannot import the harness reach the model chain through
  `navi serve` (`serve.md`) or hand navi a task through `navi mcp`
  (`mcp.md`); a full harness session over HTTP is not offered yet.
