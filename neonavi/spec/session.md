# Sessions

- SES-1: History lives in `~/.neoai/sessions/<hash>.json`, where the hash is
  the first 16 hex chars of sha256 of the working directory path.
- SES-2: One history per directory. A follow-up in the same directory continues
  it; another directory never sees it.
- SES-3: `navi -p <prompt>` continues this directory's history; bare `navi`
  starts a new one. `--resume` (or `-r`) makes the bare form continue too. When
  continuing with N > 0 messages, "· continuing (N messages)" is printed on
  stderr. Saving overwrites.
- ~~SES-4: Only the last 20 messages are kept.~~ Replaced by SES-7 to SES-10.
- SES-5: A missing or malformed file is treated as empty, never as an error.
- SES-12: A file holds `{ "cwd": <directory>, "messages": [...] }`, so a
  listing can name the directory. A file that is a bare array, as written
  before, still loads, as a history whose directory is unknown.
- SES-6: The sessions directory is created 0700 and files are written 0600.

## Compaction

History is unbounded until it no longer fits the model; then the older part is
summarised, in place, by the session's model.

- SES-7: Tokens are estimated as characters of the serialised messages divided
  by four. No tokenizer is required.
- SES-8: Before each turn, if the estimated tokens of the system prompt plus
  history exceed 70% of the resolved context window, the history is compacted.
  Otherwise it is sent as is.
- SES-9: Compaction keeps a tail of the most recent messages, up to a third of
  that budget, cut so the tail begins at a user message and a tool call is never
  separated from its result. Everything before the tail is replaced by one user
  message holding a model-written summary, followed by an assistant
  acknowledgement.
- SES-10: If the summary call fails, the head is dropped without a summary
  rather than the turn failing. When no tail fits, the whole history is
  summarised.
- SES-11: The compacted history is what gets saved, so the file stays bounded.
  "· compacted N messages" is printed on stderr when it happens.

## Managing them

- SES-13: `navi sessions` lists every saved history, most recently used
  first: its directory (or that it is unknown), how many messages, and how
  long ago it was used. This directory's is marked. Nothing is changed.
- SES-14: `navi sessions clear` deletes this directory's history;
  `navi sessions clear <directory>` that directory's; `navi sessions clear
  --all` every one. Each says what it deleted, or that there was nothing.
  Only files in the sessions directory are touched.
