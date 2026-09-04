# Sessions

- SES-1: History lives in `~/.neoai/sessions/<hash>.json`, where the hash is
  the first 16 hex chars of sha256 of the working directory path.
- SES-2: One history per directory. A follow-up in the same directory continues
  it; another directory never sees it.
- SES-3: `navi -p <prompt>` continues this directory's history; bare `navi`
  starts a new one. `--resume` (or `-r`) makes the bare form continue too. When
  continuing with N > 0 messages, "· continuing (N messages)" is printed on
  stderr. Saving overwrites.
- SES-4: Only the last 20 messages are kept, both in what is sent to the model
  and what is saved. Tool calls and results count as messages.
- SES-5: A missing, malformed, or non-array file is treated as empty, never as
  an error.
- SES-6: The sessions directory is created 0700 and files are written 0600.

## Open

- Summarising instead of dropping old messages.
- Clearing or listing sessions from the CLI.
