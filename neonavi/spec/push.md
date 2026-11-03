# Push

A job's notifications (JOB-5) sent to a phone too, through ntfy
(ntfy.sh, or a server of your own), so a job waiting on an approval
reaches you without the phone page open.

## Push

- PSH-1: `"push": "<ntfy topic URL>"` in the config (for example
  `https://ntfy.sh/<a long random topic>`), or `{ "url": …, "detail": true }`,
  sends every job notification (JOB-5) there as well, on any platform, and
  even when `"notify": false` turns the desktop ones off. Only http(s)
  URLs with a topic are taken; any other value is ignored.
- PSH-2: A push says what happened ("navi is waiting for you", "navi is
  done", …) and the job's id, and nothing more: the prompt and the command
  leave this computer only when `detail` is true. ntfy is a third party and
  anyone who knows the topic can read it, so the topic is treated as a
  secret, and the docs say so.
- PSH-3: A push sent while navi serve listens on the tailnet (JOB-10) opens
  the job on the phone page when tapped: its link names the job
  (`#job=<id>`) and never carries the token. A job waiting on an approval
  is sent with high priority.
- PSH-4: A push that cannot be sent (no network, a refusal, more than 5
  seconds) is given up on without retrying, and never fails or slows the
  job; navi serve logs that it failed, with the status, never the topic.
- PSH-5: The phone page opens the job named by `#job=<id>` in its link,
  using the token it already holds.
- PSH-18: `"push": { "url": …, "notify": "waiting" }` pushes only what
  needs the user, as `"notify": "waiting"` does on the Mac (JOB-38). The two
  are set apart: the Mac can say everything while the phone says only what
  waits.
- PSH-6: `navi push test` sends a test push and says whether it arrived
  at the server; with no `push` in the config it says how to set one up.

## Answering from the notification

- PSH-7: When a job waits on an approval, navi serve listens on the tailnet
  and `detail` is true, its push has Yes and No buttons (ntfy http actions)
  that answer the approval from the notification itself and clear it.
- PSH-8: The buttons never carry the token: each approval gets its own key,
  128 random bits. `POST /answer/<job>/<key>` with the body `yes` or `no`
  answers that approval without the token, only while it waits, once; any
  other key, or the key of an approval already answered, is refused with
  403 and nothing changes. Keys are kept in memory only, never saved or
  shown by the jobs API. The phone sends the answer itself, so it reaches
  navi only from the tailnet.
- PSH-9: Without `detail` there are no buttons: the push does not say what
  would be allowed, so tapping it opens the page to see.
- PSH-10: navi serve's log shows an answer by key without the key, and the
  job's log records it as any other answer.

## Quiet hours

- PSH-11: `"quietHours": "22:00-07:00"` in the config holds navi serve's
  notifications, on the Mac and pushed alike, from the first time to the
  second, local time (SCH-14); a span may cross midnight. The config is
  read each time, so a change needs no restart. A value that is not two
  `HH:MM` times joined by `-` is ignored, and navi serve says so on start.
- PSH-12: What was held is sent as one notification once the quiet hours
  end (within half a minute): how many jobs finished, failed, wait on the
  user, and anything else, with the first few named, opening the last of
  them. An approval held is in it as waiting; its buttons are not.
- PSH-13: What is held is kept in memory only: a navi serve stopped during
  quiet hours does not send it.

## Seeing what is asked

- PSH-14: A job waiting on a file change says, after the one line naming
  it, the change's changed lines (`-` and `+`, no lines around them): the
  first 6, each cut at 60 characters, then how many more there are. It is
  the same diff the phone page shows, made visible (TL-38), so nothing in
  it can hide. On the Mac it is always shown; pushed, only with `detail`
  (PSH-2).
- PSH-15: A job waiting on a browser action says the page it is on: host
  and path, cut at 60 characters, never the query or fragment, which can
  hold what a page keeps private.
- PSH-16: The quiet hours summary (PSH-12) names a waiting job by its first
  line only.
- PSH-17: A job waiting on a browser action keeps a picture of the page as
  it looks (a JPEG of the tab, taken once when asking; none if that fails
  or takes over 10 seconds), in memory only, until it is answered. Its
  `pending` says `shot: true` once there is one, and `GET
  /jobs/<id>/page.jpg` gives it, with the token; otherwise a 404. The phone
  page shows it in the approval card, so a click or a form is answered
  having seen the page. It is never pushed (PSH-15).

## Open

- An image of the page with a browser action's push. Not as an attachment
  to the push server: ntfy.sh is a third party, and a page can show what the
  user would not send it. A link to the phone page, which can show it over
  the token, would do.
