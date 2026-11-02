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

## Open

- Route by the ledger: start a kind of turn on the model that has done it
  well, and escalate sooner from one that has not.
- Asking the same thing again in other words, as a signal.
