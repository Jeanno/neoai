# Undo

Putting files back the way they were before navi's last turn changed them.

## What is kept

- UND-1: Each file navi writes with write_file or edit_file is recorded with
  what it held before (or that it did not exist) and what navi wrote, as the
  change is made, in `~/.neoai/undo/<key>.json` for the working directory
  (keyed as sessions are, SES-1). The directory is 0700 and the file 0600:
  it holds file contents.
- UND-2: Changes are grouped by the turn that made them, with the turn's
  prompt and time, and the shell commands the turn ran. Only turns that
  changed a file are kept, the last 10 of them.
- UND-3: A file bigger than 1 MB before or after is recorded by path only
  and cannot be undone; undo says so.

## Undoing

- UND-4: `navi undo` (and `/undo` at the `navi>` prompt) undoes the latest
  kept turn in this directory: each change, newest first, puts back what the
  file held, and a file the turn created is removed. Undoing again goes a
  turn further back.
- UND-5: A file that no longer holds what navi wrote (changed by hand or by
  something else since) is left as it is and named, so undo never throws
  away work that was not navi's.
- UND-6: When the turn ran shell commands, undo lists them and says what
  they did is not undone.
- UND-7: The model is told at the start of the next turn in that directory
  which files were put back, so it does not work from its own undone edits.
- UND-8: `navi undo --list` lists the kept turns, newest first, with when,
  the prompt and the files each changed. `-C <directory>` undoes or lists
  another directory's, as jobs run there.
- UND-9: Nothing to undo is said plainly and exits 1.

## Jobs

- UND-10: A job's turns are kept with the job's id, in the job's directory.
  `GET /jobs/<id>` lists the files its kept turns changed as `changes`.
- UND-11: `POST /jobs/<id>/undo` undoes every kept turn of that job, newest
  first, as UND-4 to UND-6 would, and answers with what was put back,
  removed and left, and the commands not undone. A job still running or
  waiting is not undone (400); nor is one with nothing kept (400).
- UND-12: What was undone is added to the job's log.
- UND-13: The phone page shows a finished job's changed files with an
  Undo changes button, asked to confirm, then says what happened.
  `navi jobs <id> undo` does the same from the terminal.

## Open

- Undo from Raycast.
- Redo.
