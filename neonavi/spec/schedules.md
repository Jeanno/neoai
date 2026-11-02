# Schedules

Jobs (`jobs.md`) that navi serve starts by itself: at a time of day, or
every so often. A morning brief, a page watched every hour.

## Schedules

- SCH-1: A schedule is a prompt, a directory (as JOB-9), and when: `at` a
  time of day (`HH:MM`, this computer's local time), on every day or only
  on the days named, or `every` so many minutes or hours (5 minutes at the
  least).
- SCH-2: When a schedule is due, navi serve starts it as a job (JOB-1),
  which carries the schedule's id and is followed, approved and answered
  like any other. An `every` schedule is due that long after its last run
  (after it was made, before the first); an `at` schedule at the next time
  of day, on a day it runs, after its last run.
- SCH-3: A schedule whose last job is still running or waiting is not
  started again; that run is skipped, so a slow or unanswered job never
  piles up copies of itself.
- SCH-4: Runs missed while navi serve was stopped are not made up one by
  one: when it starts again a schedule that is due runs once, unless it was
  due more than 12 hours before, which is skipped (a morning brief does not
  arrive at midnight).
- SCH-5: Schedules are kept in `~/.neoai/schedules.json` (0600, in a 0700
  directory) with when each last ran, so they survive navi serve
  restarting.
- SCH-6: navi serve looks for due schedules at least every 30 seconds.

- SCH-14: Local time (an `at` schedule, its next run, and today's date in
  the prompt, PRM-13) follows this computer's own zone rules, read from its
  zoneinfo (`TZ` when it names a zone, else `/etc/localtime`), not the
  runtime's bundled copy, which can lag behind the law: Node 26 shipped
  tzdata 2026a, with British Columbia still on PST after it moved to
  permanent UTC-7 on 1 November 2026. When neither reads, the runtime's
  rules are used.

## Watches

- SCH-9: A schedule made a watch (`quiet`) tells each run after the first
  what the last run with news answered (its first 4000 characters), and to
  answer exactly `NOTHING NEW` when nothing the user would want to hear
  about has changed since. The first run, with nothing to compare, answers
  as usual.
- SCH-10: A watch's job that answers `NOTHING NEW` is done and marked
  unchanged: listed as "nothing new", with no notification or push (JOB-5,
  PSH-1). Any other answer is notified as usual and is what the next run
  compares against.
- SCH-11: The job's prompt stays the user's own; what a watch adds goes to
  the model, not into the prompt shown.

## The API

- SCH-7: navi serve answers, with the token (JOB-8): `GET /schedules`
  (each schedule with its next run), `POST /schedules` with `{ prompt,
  directory?, at?, days?, every?, quiet? }` (the new schedule, 201; `every`
  in minutes, `days` as 0 for Sunday to 6, `quiet` true for a watch),
  `POST /schedules/<id>/run` (starts it now, as a job, 201) and `POST
  /schedules/<id>/delete`. A missing
  schedule is a 404; anything else wrong is a 400 saying what.

## The CLI

- SCH-8: `navi schedule "<prompt>" --at HH:MM [--days mon,tue,…] [-C
  <dir>]` or `--every <N>m|<N>h`, with `--only-changes` for a watch (SCH-9),
  adds a schedule (in this directory unless told) and says when it next runs; `navi schedules` lists them with their
  next run; `navi schedules <id> run` starts one now; `navi schedules <id>
  rm` deletes it. Like `navi jobs`, they talk to navi serve (JOB-13).

## On the phone

- SCH-12: The phone page (JOB-10) lists the schedules, soonest first, each
  with when it runs, its next run and whether it is a watch, with Run now
  (which opens the job it starts) and Delete (after a confirmation). Its
  box for starting a job can instead make a schedule: every 30 minutes,
  every hour, or every day or every weekday at a time chosen, and, for any
  of them, a watch (SCH-9).
- SCH-13: The page does not redraw itself every few seconds while a
  choice is open in it (a list, a time or a checkbox), so a choice is never
  snatched away mid-pick.

## Editing

- SCH-15: A schedule can be changed in place: its prompt, when, or whether
  it is a watch. It keeps its id, directory and last job. A changed when
  counts from the change: the next run is the first one after it, so an
  every-30-minutes schedule runs 30 minutes after being edited, not at once.
  A watch forgets the answer it compares with (SCH-10) when its prompt
  changes or it stops being a watch, so what it next says is news again.
- SCH-16: `POST /schedules/<id>/edit` with `{ prompt?, at?, days?, every?,
  quiet? }` changes only what is given, checked as SCH-7 checks a new one,
  and answers the schedule with its next run. `at` or `every` replaces when
  it runs, with `days` going with `at` (`null` for every day); `days` alone
  changes the days of an `at` schedule.
- SCH-17: `navi schedules <id> edit` takes `--prompt "<prompt>"`, `--at
  HH:MM`, `--days mon,tue,…` (or `all`), `--every 30m|2h`, and
  `--only-changes` or `--every-run` to make it a watch or not, at least one
  of them, and says what the schedule now is and when it next runs.
- SCH-18: On the phone page, Edit on a schedule opens it as a form in its
  card: the prompt, when it runs (the choices a new one has, and a schedule
  on other days keeps them unless another choice is made), the time, and
  the watch checkbox, with Save and Cancel. What is being typed survives the
  page's refreshes.

## Pausing

- SCH-19: A paused schedule is kept, with everything about it, but never
  comes due; Run now still starts it. Resuming counts from the resume, as an
  edit does (SCH-15): runs missed while it was paused are not made up, and
  the next run is the first one after it. Paused survives a restart (SCH-5).
- SCH-20: `POST /schedules/<id>/pause` and `POST /schedules/<id>/resume`
  answer the schedule; `GET /schedules` marks a paused one `paused: true`
  and lists it after those that will run.
- SCH-21: `navi schedules <id> pause` and `navi schedules <id> resume`, and
  Pause and Resume on the phone page, which shows a paused schedule as
  Paused instead of its next run; `navi schedules` shows it as paused.

## How it has gone

- SCH-22: `GET /schedules` gives each schedule its `runs`: the jobs it
  started that are still kept (JOB-6), newest first, at most five, each as
  `{ id, status, created, unchanged? }`. Nothing about a job but that.
- SCH-23: Each run is shown as a mark, oldest first: ✓ done, – done with
  nothing new (SCH-10), ✗ failed or interrupted, ■ stopped, … still
  working. `navi schedules` prints the marks after each schedule's when.
- SCH-24: On the phone page the marks sit on the schedule's card, each
  colored as its status is in the job list and named for a screen reader
  (`done, 2 h ago`); tapping one opens its job.

## Failing

- SCH-25: A schedule counts its runs that fail in a row, as each one ends
  (within SCH-6's half minute), a run tried again (SCH-28) counting once,
  by how its second try ended. A run that is done resets the count; one
  stopped or interrupted (navi serve stopping under it) leaves it as it is;
  one whose job is gone is not counted.
- SCH-26: On the third failure in a row navi pauses the schedule itself
  (SCH-19), marked `stuck`, and sends one notification (PSH) saying so,
  linking the last failed job. Resuming clears the count and the mark;
  so does editing it (SCH-15), which also resumes one navi paused, an edit
  being the likely fix. One the user paused stays paused through an edit.
- SCH-27: The phone page shows a schedule navi paused as `Paused after 3
  failed runs`; `navi schedules` shows it as `paused: failing`.

## Trying again

- SCH-28: A run that came due (not Run now) and failed is tried once more,
  5 minutes after it ended, unless the schedule's next run comes before
  that, which then serves instead. The second try is a job of its own,
  marked `retryOf` the failed one, whose log says so; it does not move the
  schedule's next run. It is not tried again itself, and is skipped while
  the schedule is paused or its last job still busy.
- SCH-29: Pausing, resuming or editing a schedule drops a second try still
  to come. `GET /schedules` gives one to come as `retryAt`; the phone page
  shows `Trying again in N min` in place of the next run, and `navi
  schedules` `retry in N min`.

## Open

- Quiet hours: schedules that do not notify between times the user sets.
