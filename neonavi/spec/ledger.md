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

## Open

- Route by the ledger: start a kind of turn on the model that has done it
  well, and escalate sooner from one that has not.
- An outcome signal from the user: a retry or a correction right after an
  answer.
