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

## Open


- Editing a schedule in place, rather than deleting it and making another.
