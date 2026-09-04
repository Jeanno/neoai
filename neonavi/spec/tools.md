# Tools

Five tools. Nothing writes to disk except a shell command the user approved.

## Limits

- TL-1: Any tool result longer than 8000 characters is cut there and marked
  `…[truncated]`.
- TL-2: grep and glob return at most 100 hits and say how many were dropped.
- TL-3: read_file returns at most 400 lines per call.

## grep / glob

- TL-4: Both use ripgrep, so `.gitignore` and hidden files are honoured.
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

- TL-13: Every call asks the user first, showing the exact command. Nothing is
  remembered between calls.
- TL-14: Only a line reading `y` (case-insensitive, trimmed) approves. Any
  other input, or no input at all (closed or redirected stdin), declines.
- TL-15: A decline returns a message telling the model not to retry and to try
  another approach.
- TL-16: Commands run through the shell with a 120s timeout. Output is stdout,
  else stderr, else "(no output)".
- TL-17: A failing command returns its stderr or error message as the tool
  result so the model can recover; it is never thrown.

## Open

- A write/edit tool, gated like run_shell.
- Per-command allowlist to skip approval.
