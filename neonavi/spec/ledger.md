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
- LED-14: `navi stats` shows, for a model whose answers were asked for again,
  their share of its answers (`25% asked again`).
- LED-15: A turn that corrects or repeats (LED-7, LED-13) also records
  `aboutKind`, the kind (LED-11) of the turn before it, and an undo line
  (LED-9) records the undone turn's `kind`, by its prompt as kept for undo
  (files attached to it are not kept there, so it is `change` or `ask`).

## Open

- Routing by more than the three kinds, such as by the tools a turn ends up
  using.
- Which of a model's turns a correction, repeat or undo was about, rather
  than how many of its kind since its first sampled turn (ESC-7).
