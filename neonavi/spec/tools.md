# Tools

Six tools. Nothing writes to disk except a shell command the user approved.
Only web_search and the model itself send anything off the machine.

## Limits

- TL-1: Any tool result longer than 8000 characters is cut there and marked
  `…[truncated]`.
- TL-2: grep and glob return at most 100 hits and say how many were dropped.
- TL-3: read_file returns at most 400 lines per call.

## grep / glob

- ~~TL-4: Both use ripgrep.~~ Replaced by TL-31.
- TL-31: Both honour `.gitignore` and skip hidden files. They use ripgrep when
  it is installed and a built-in search otherwise, with the same results, so
  neither needs anything installed.
- TL-5: `node_modules` and `.git` are always excluded, gitignore or not.
- TL-6: grep returns `file:line:text`. glob returns one path per line.
- TL-7: No match is a normal result ("no matches for …"), not an error.
- TL-8: `path` defaults to the working directory.

## read_file

- TL-9: Lines are numbered `N→text`, 1-based, so the model can cite them.
- TL-10: `offset` (first line) and `limit` (line count) page through a file.
- TL-11: Output is cut on a line boundary when either the line limit or the
  size limit is hit, and the tail says how many lines remain and which offset
  continues.

## list_dir

- TL-12: Returns the directory's entries, one per line.

## run_shell

- TL-13: Every call is judged first (see below); anything not judged safe asks
  the user, showing the exact command. Nothing is remembered between calls.
- TL-14: Only a line reading `y` (case-insensitive, trimmed) approves. Any
  other input, or no input at all (closed or redirected stdin), declines.
- TL-15: A decline returns a message telling the model not to retry and to try
  another approach.
- TL-16: Commands run through the shell with a 120s timeout. Output is stdout,
  else stderr, else "(no output)".
- TL-17: A failing command returns its stderr or error message as the tool
  result so the model can recover; it is never thrown.

## web_search

- TL-26: `web_search(query)` returns up to 8 results, each a title, URL and
  snippet, numbered so the model can cite them.
- TL-27: It needs no key: results come from DuckDuckGo's HTML endpoint. Ads
  are dropped and redirect links are unwrapped to the destination URL.
- TL-28: The query is the only thing sent. It is echoed like every tool call
  (CLI-10), so a search is never silent; it is not gated by approval, because
  it reads and writes nothing on the machine.
- TL-29: No results is a normal result ("no results for …"). A network error,
  timeout (10s) or blocked request returns a message saying search is
  unavailable, never a throw, so the model can answer without it.
- TL-30: `"web_search": false` in `~/.neoai/config.json` removes the tool, for
  sessions where nothing but the model may leave the machine.

## Safety judge

A model call that decides whether a shell command needs the user's approval.

- TL-22: A command judged `safe` runs without asking. A dim line on stderr
  says it was auto-approved, so the user still sees every command.
- TL-23: `unsafe` and `unknown` both fall to the `[y/N]` prompt, so a closed
  stdin still declines them (TL-14).
- TL-24: `"approve": "ask"` in `~/.neoai/config.json` skips the judge and
  asks for everything. Any other value, or none, means judge first.
- TL-25: The judge uses the session's model. No separate model is configured.

- TL-18: `judge(model, command, intent)` returns `safe`, `unsafe` or
  `unknown`. `intent` is the user's current prompt, so "delete the build dir"
  makes `rm -rf build` judgeable.
- TL-19: The model is asked for a one-word verdict. Only a line reading
  exactly SAFE or UNSAFE (case-insensitive) counts; the last such line wins.
  Any other output is `unknown`.
- TL-20: A model error, timeout, or empty reply is `unknown`, never a throw.
- TL-21: Safe means read-only, or writing only inside the working directory
  without deleting or overwriting existing files, with no network sends, no
  privilege escalation, no process kills, and no git history rewriting or
  pushing. Everything else, including anything the judge cannot tell, is unsafe.

## Open

- A write/edit tool, gated like run_shell.
- A keyed search backend (Brave, Tavily, SearXNG) when DuckDuckGo blocks.
- A fetch tool to read a result's page, not just its snippet.
- Per-command allowlist to skip approval.
