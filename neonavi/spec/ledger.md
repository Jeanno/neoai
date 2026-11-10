# Ledger

A record of how each turn went, kept on this computer, so navi can tell which
model does which work well (and, later, route by it). It holds counts, never
what was said.

- LED-1: Every turn a front end runs (HAR-2) adds one line
  to `~/.neoai/ledger.jsonl`: when it ended, the front end (`cli`, `raycast`,
  `mcp`, `job`), the model that answered as the front end names it (backend
  and model id), whether prompts stayed on this computer, how long the turn
  took, how many model steps it used, each tool by name with how many times
  it was called, how many tool calls failed, how many approvals the user
  declined, the length of the prompt in characters, how many files were
  attached, and how it ended: `answered`, `empty`, `error` or `stopped`.
- LED-2: The prompt, the answer, tool inputs and outputs, file names, paths
  and URLs are never written to the ledger.
- LED-3: A turn that escalated (ESC-3) also records the model it started on
  and why it escalated; the answering model is the one it ended on.
- LED-4: The file is created 0600 in a 0700 directory. Past 5 MB its older
  half is dropped. A line that cannot be written, or read back, is skipped,
  never an error for the turn or the reader.
- LED-5: `"ledger": false` in `~/.neoai/config.json` writes nothing.
- LED-6: `navi stats [--days N]` summarises the last N days (30 unless
  told otherwise), one line per model, most turns first: its turns, the
  share answered, empty, failed and stopped, steps and failed tool calls per
  turn, the median time, and how many of its turns escalated away. With
  nothing recorded it says so. Nothing is changed.

- LED-7: A turn whose prompt reads as a correction of the answer before it
  in the same conversation, within 30 minutes, records `corrects`: the model
  that gave that answer, and nothing of the prompt. It reads as one by its
  first words only ("no", "that's wrong", "not quite", "it still doesn't",
  "try again", "you forgot", …, but not "no worries" or "no need"), so a
  question about something wrong is not taken for it. The first turn of a
  conversation, resumed or new, corrects nothing.
- LED-8: `navi stats` shows, for a model that has been corrected, the share
  of its answers that were (`25% of answers corrected`).

- LED-9: An undo that puts anything back (`navi undo`, `/undo`, or a job's
  undo on the phone, UND-4 and UND-11) adds a line per turn undone,
  `{ at, undid }`: when, and the model that answered that turn, kept with
  the turn's changes for this. Nothing else, so no path or file name. It
  is not a turn: readers of turns skip it. A redo does not take it back.
- LED-10: `navi stats` shows, for a model with turns undone, the share of
  its turns that changed a file which were (`50% of edits undone`), or the
  count when none of its turns on record changed one.

- LED-11: Each turn records its `kind`, by its prompt's first words as LED-7
  reads them: `attached` when files were sent with it, `change` when it
  starts by asking for one ("fix", "add", "write", "rename", "please
  update", "can you remove", …), and `ask` otherwise. The label is kept,
  never the words.
- LED-12: `navi stats` shows turns routed past a model (ESC-6) apart from
  those that escalated away from it (`2 routed past it`).

- LED-13: A turn whose prompt asks the one before it again in other words,
  in the same conversation and within 30 minutes of that answer, records
  `repeats`: the model that gave that answer, and nothing of either prompt.
  It reads as one when each prompt has at least three words that matter
  (small words such as "the", "how", "please" left out) and more than 60% of
  them are shared, so a new request that shares a verb ("fix the login bug",
  "fix the signup bug") is not. A turn that reads as a correction (LED-7) is
  recorded as that instead; navi's own notes in the conversation are not
  taken for what was asked; the first turn of a conversation repeats nothing.
- LED-17: A turn asked again with `/retry` (CLI-33) records `repeats`: the
  model whose answer it replaces, with `aboutKind` that turn's kind, however
  its prompt reads.
- LED-14: `navi stats` shows, for a model whose answers were asked for again,
  their share of its answers (`25% asked again`).
- LED-15: A turn that corrects or repeats (LED-7, LED-13) also records
  `aboutKind`, the kind (LED-11) of the turn before it, and an undo line
  (LED-9) records the undone turn's `kind`, by its prompt as kept for undo
  (files attached to it are not kept there, so it is `change` or `ask`).
- LED-16: Under a model's line, `navi stats` shows its turns by kind
  (LED-11), a line each, when they are of more than one kind: `changes`,
  `questions` and `with files`, each with its turns, the share answered,
  and of those answers the share corrected and asked again (by `aboutKind`,
  LED-15), and the share of its edits undone. With `"route": "ledger"` and
  an escalation model (ESC-6), a kind that routing would start elsewhere
  now, judged as routing judges it (its own 30 days, not `--days`), is
  marked `routing starts these elsewhere now`, and shown even when it is
  the only kind or has no turns in the days shown.
- LED-18: Each turn also records the tokens it used, as the backend reported
  them, summed over its model steps: `tokens` (`in`, `out`, and `cached`,
  the part of `in` read from the provider's cache) for the answering model,
  and, for a turn that escalated, the first model's under `escalated`. A
  step the backend gave no counts for adds nothing, and a turn with none at
  all records no `tokens`. Streamed calls ask the backend for their counts
  (`stream_options.include_usage`); a server that refuses that field is asked
  again without it.
- LED-19: `navi usage [--days N]` (default 30) shows a line per model: its
  turns, the tokens it used in the days shown (`120k in, 8k out`; `no token
  counts` when none were recorded), and what they cost, estimated: free for a
  model on this computer, and for a hosted model priced in navi's table
  (Claude models, by id, whether named directly or through OpenRouter), or
  in `prices` in `~/.neoai/config.json`, `~$0.42`. A hosted model with no
  price says `price unknown`. The most expensive comes first. `navi stats`
  shows neither tokens nor cost. A last line totals the estimate, says it is
  estimated from list prices, and how many turns have no token counts.
- LED-20: `prices` in the config maps a model id, as the ledger names it
  (`claude-sonnet-5-5`, `qwen3.6-35b-a3b-vl-mtp-mxfp8`), to US dollars per
  million tokens: `{ "in": 2, "out": 10, "cached": 0.2 }`, `cached` taking
  `in`'s price when left out. It wins over navi's own table.

## Open

- Routing by more than the three kinds, such as by the tools a turn ends up
  using.
- Which of a model's turns a correction, repeat or undo was about, rather
  than how many of its kind since its first sampled turn (ESC-7).
