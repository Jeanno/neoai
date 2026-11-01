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
- PSH-6: `navi push test` sends a test push and says whether it arrived
  at the server; with no `push` in the config it says how to set one up.

## Open

- Answering Yes or No from the notification itself (ntfy actions), which
  would need the token to leave this computer.
