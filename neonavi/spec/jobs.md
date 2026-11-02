# Jobs

Work handed to navi to do in the background: started from the terminal, or
from a phone over Tailscale, and followed, approved and answered from either.
Jobs run inside `navi serve` (`serve.md`), so they keep going when the
terminal that started them closes.

## Jobs

- JOB-1: A job is one prompt run as a harness session (HAR-2) in a directory
  (the home directory unless given), on the configured chain with
  escalation (ESC-1), the browser tools (HAR-9) and the ledger as `job`
  (LED-1). Several jobs run at once, each on its own, up to JOB-21.
- JOB-2: A job is `queued` (JOB-21), `running`, `waiting` (on an
  approval), `done`, `failed` (no model answered, or the turn ended with no
  answer and an error), `stopped`, or `interrupted` (navi serve stopped
  while it ran). It keeps a
  log of what it did, one line per tool call, auto-approval, escalation,
  compaction or error, as the CLI shows them (CLI-10), and its answer.
- JOB-3: A job is followed up with another prompt, which continues its
  conversation as a new turn, and runs again; one that is running or
  waiting cannot be.
- JOB-4: What would ask the user (HAR-4) waits in the job as its pending
  approval, with the command, change or browser action and its page, until
  it is answered yes or no or the job is stopped. Nothing is ever answered
  "always" from a job.
- JOB-5: On macOS a notification says when a job is waiting on an approval
  and when it ends, naming the job by the start of its prompt, unless
  `"notify": false` is in the config.
- JOB-6: Jobs are kept in `~/.neoai/jobs/<id>.json` (0600, in a 0700
  directory) as they change, with their conversation, so they survive navi
  serve restarting: one that was running or waiting is then `interrupted`,
  and can be followed up. The 100 most recent are kept.

## The API

- JOB-7: navi serve answers, under `/jobs`: `GET /jobs` (each job, newest
  first, without its conversation or log), `POST /jobs` with `{ prompt,
  directory? }` (the new job, 201), `GET /jobs/<id>` (one job with its log
  and pending approval), `POST /jobs/<id>/answer` with `{ yes }`, `POST
  /jobs/<id>/reply` with `{ prompt }` (JOB-3), `POST /jobs/<id>/stop`,
  `POST /jobs/<id>/undo` (UND-11), and
  `GET /jobs/directories` (the directories with saved conversations, SES-13,
  to offer as places to work). A missing job is a 404; anything else wrong
  with a request is a 400 saying what.
- JOB-8: Every `/jobs` request needs `Authorization: Bearer <token>`, the
  token in `~/.neoai/serve-token` (64 hex characters, made 0600 the first
  time navi serve starts); without it the answer is a 401. A job can run
  shell commands, so nothing less is accepted, from anywhere.
- JOB-9: A directory given must be an absolute path to a directory that
  exists.

## From a phone

- JOB-10: `navi serve --tailnet` also listens on this computer's Tailscale
  addresses (IPv4 in 100.64.0.0/10), on the same port. There every request,
  the model endpoints too, needs the token (JOB-8), and `GET /` is a page
  for a phone: the jobs, newest first, with their status; a job's log,
  answer and pending approval with Yes and No; a box to start a job (with
  the directories of JOB-7 to choose from) and one to follow one up. It
  reads the token from the link's fragment, which is never sent to a
  server, keeps it in the phone's own storage, and refreshes every few
  seconds. With no Tailscale address it says so and serves this computer
  only.
- JOB-11: The page's own requests come with an `Origin`; those to `/jobs`
  are let through when they carry the token (SRV-5 still holds for the
  model endpoints).
- JOB-12: `navi jobs link` prints the page's link, token included, for each
  Tailscale address, and says the link is a key to this computer. navi
  serve never prints or logs the token.

## The CLI

- JOB-13: `navi job "<prompt>" [-C <directory>]` starts a job in navi serve
  (in this directory unless told) and prints its id and how to follow it;
  `navi jobs` lists jobs; `navi jobs <id>` shows one; `navi jobs <id> y` or
  `n` answers its approval; `navi jobs <id> stop` stops it. They talk to
  navi serve on 127.0.0.1 (port 8484 unless `--port`), and when it is not
  running say how to start it (`navi serve`, or `navi serve --install`).

## Files

- JOB-14: `POST /jobs` may carry `files`: up to 4 of `{ name, data }`, the
  data base64, 25 MB at most together once decoded. Each is read as a file
  given to `attach()` would be (HAR-7: an image scaled and shown, a PDF's
  text or pages, text), under its own name, and sent with the job's first
  turn. A file that cannot be attached refuses the whole job with a 400
  naming it, and no job starts. The files are written to a private temporary
  directory only while they are read, and removed after.
- JOB-15: A job lists the names of the files it was given as `files`; the
  files themselves are kept only in its conversation (HAR-8), which the jobs
  API never sends, so a phone following a job does not fetch its photos
  again every few seconds.
- JOB-16: The phone page has an Add photo or file button that takes photos
  from the camera or library, or any file, shows each chosen file's name
  with a way to remove it, and sends them with a job started now. A
  schedule takes no files. `navi job "<prompt>" -a <file>` (more than once
  for more) does the same from the terminal.
- JOB-19: `POST /jobs/<id>/reply` may carry `files` as `POST /jobs` does
  (JOB-14), sent with that follow-up's turn: one that cannot be attached
  refuses the follow-up with a 400 naming it, and the job does not run
  again. Their names are added to the job's `files` and to the follow-up's
  line in its log.
- JOB-20: The phone page's follow-up box has the same Add photo or file
  button as a new job (JOB-16), and the files go with that follow-up only;
  leaving the job for the list forgets the follow-up not sent. `navi jobs
  <id> reply "<follow-up>" [-a <file>]…` follows a job up from the terminal,
  and `navi jobs <id>` says so for a job that is not working.

## Answers on the phone

- JOB-17: The phone page shows a job's answer with its Markdown formatted:
  paragraphs, headings, bulleted and numbered lists, quotes, code (inline
  and fenced), tables, rules, bold, italics and links. It is built as page
  elements holding the answer's text, never as HTML read from the answer,
  so nothing in an answer (which may quote a web page) can run, style the
  page or load anything.
- JOB-18: Only http and https links become links; they open in a new tab
  without a referrer. Any other link (`javascript:`, `data:`, a relative
  path) is shown as the text it was written as.

## A queue

- JOB-21: At most `"jobsAtOnce"` jobs run at once: 2 unless the config
  gives another whole number, 1 at the least. A job started or followed up
  past that is `queued`, with a line in its log saying how many are ahead
  of it, and runs in the order queued as a place frees. A job waiting on an
  approval holds no place, since its model is idle; once answered it goes on
  at once.
- JOB-22: A queued job counts as working (as running or waiting do): it
  cannot be followed up or undone, and a schedule whose last job is queued
  skips (SCH-3). Stopping it takes it out of the queue, `stopped` without
  having run. When navi serve stops, a queued job comes back `interrupted`
  (JOB-6), to be followed up.
- JOB-23: `navi jobs` and the phone page show a queued job as `queued`; the
  phone page offers Stop for it, as for one running.

## Open

