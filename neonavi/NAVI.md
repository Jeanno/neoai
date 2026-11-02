# neonavi

`navi` — a command-line agent. Bare `navi` in a terminal opens a conversation
at a `navi>` prompt; `navi -p "<what you want done>"` answers that first and then
keeps the prompt open. Each turn runs a tool loop until it has an answer, then
prints it. ^C stops an answer midway and keeps what was said; at an empty
prompt `exit`, ^C or ^D leave. A pasted block of lines is one prompt. Up arrow
recalls earlier prompts, kept in `~/.neoai/history` (start a line with a space
to leave it out).

    navi
    navi -p "where is shell approval handled"
    navi -p "what changed in this file" --model best
    navi -a screenshot.png -p "what is this error"
    navi -a paper.pdf -a notes.md -p "does my summary miss anything"
    git diff | navi -a - -p "write a commit message"

`-a` attaches a file to the prompt: an image goes to the model as an image
(scaled to 1600 px), a PDF as its text (a scanned one as images of its first
8 pages, on macOS), any other text file as it is. `-a -` attaches what is
piped in; nothing piped can then answer an approval, so commands that need
one are declined. At the
prompt, `/attach <file>` (drag a file in) sends one with your next message,
`/model <spec>` switches model for the rest of the conversation, and `/help`
lists these.

`navi serve` puts the same model chain behind an OpenAI-compatible server on
this computer: give any app the base URL `http://127.0.0.1:8484/v1`, any API
key, and the model `navi`, and it answers with your model and falls back the
same way. Requests pass through as sent (images, tools, streaming); only
this computer can reach it, and a web page cannot. `navi serve --install`
keeps it running at login (macOS); `--uninstall` stops that (`spec/serve.md`).

navi serve also runs jobs: work handed off to carry on in the background,
whether or not a terminal stays open. `navi job "<prompt>"` starts one here
(`-C <dir>` elsewhere); `navi jobs` lists them, `navi jobs <id>` shows what one
did and its answer, `navi jobs <id> y` or `n` answers what it is waiting on, and
`stop` stops it. A macOS notification says when a job waits for you and when it
ends (`"notify": false` turns that off). With `navi serve --tailnet` (or
`navi serve --install --tailnet`) it also listens on this computer's Tailscale
address, where every request needs the token in `~/.neoai/serve-token`, and
serves a page for your phone: start jobs, follow them, answer Yes or No.
`navi jobs link` prints the link to open on the phone; it holds the token, so
treat it as a key to this computer (`spec/jobs.md`).

    navi serve --install --tailnet
    navi job "check the build log in ~/Projects/app and tell me what broke"
    navi jobs link

Jobs can start by themselves. `navi schedule "<prompt>" --at 08:00` runs one
every morning (`--days weekdays`, or `mon,thu`, for only some days), and
`--every 30m` or `--every 2h` runs one every so often; `navi schedules` lists
them with when each runs next, `navi schedules <id> run` runs one now and `rm`
deletes it. A run that comes due while the last one is still going (or waiting
for your answer) is skipped, and runs missed while navi serve was off are made
up once, not one by one, unless they are more than 12 hours late
(`spec/schedules.md`).
A schedule can be changed in place, with `navi schedules <id> edit` (`--prompt`,
`--at`, `--days`, `--every`, `--only-changes` or `--every-run`) or Edit on the
phone page; a new time counts from the change (SCH-15 to SCH-18).
`navi schedules <id> pause` (or Pause on the phone) keeps one without it
running, and `resume` starts it again from then, missed runs not made up
(SCH-19 to SCH-21).
Each schedule shows how its last five runs went, as marks (✓ done, – nothing
new, ✗ failed, ■ stopped, … working): in `navi schedules`, and on the phone,
where a mark opens its job (SCH-22 to SCH-24).
A schedule that fails three runs in a row pauses itself and tells you once,
instead of failing all night; Resume, or an edit, starts it again
(SCH-25 to SCH-27).
Before that, a run that came due and failed is tried once more five minutes
later (unless the next run is sooner), so a model away for a minute does not
cost you the morning's brief; only a failed second try counts (SCH-28, SCH-29).

    navi schedule "summarise what's new on my GitHub notifications page" --at 08:30 --days weekdays

Add `--only-changes` to make a schedule a watch: each run is shown what the
last run with news said and answers `NOTHING NEW` when nothing worth telling
you has changed. Those runs are listed as "nothing new" and send no
notification or push, so you only hear from it when something happened.

    navi schedule "check https://status.example.com and tell me about incidents" --every 30m --only-changes

A job can take files: on the phone page, Add photo or file takes a photo
from the camera or library (sent as a JPEG at most 1600 pixels on a side) or
any file, up to four; from the terminal, `navi job "…" -a receipt.jpg`. navi
serve reads them as `-a` does, so a photo of a receipt or a whiteboard, a PDF
or a text file all work (`spec/jobs.md` JOB-14 to JOB-16).
A follow-up can bring files of its own, from the phone page's follow-up box
or with `navi jobs <id> reply "<follow-up>" -a <file>` (JOB-19, JOB-20).
Two jobs run at once (`"jobsAtOnce"` in the config changes that); the rest
wait as `queued` and start in order, and one waiting on your yes or no
holds no place (JOB-21 to JOB-23).
A job you are done with can be deleted (`navi jobs <id> delete`, or Delete
job on the phone page), and `navi jobs clear` or Clear finished jobs
deletes every one not still working (JOB-24 to JOB-26).
A job followed up keeps its earlier answers: on the phone page under
Earlier in this job, and all of it with `navi jobs <id> show`
(JOB-27 to JOB-29).
To find a job, type in Find a job above a phone list of more than three,
or run `navi jobs find <words>`: jobs holding every word, in the prompt or
the answer (JOB-30, JOB-31).
A job that went well can be repeated on a schedule: Repeat this… on the
phone, or `navi jobs <id> repeat --at 08:00` (or `--every 2h`), with its first
prompt in its folder (JOB-32 to JOB-34).
Answers on the phone page are shown formatted (headings, lists, tables,
code, links), and since an answer can quote a web page, none of it is ever
read as HTML: only http(s) links work, and nothing in an answer can run
(JOB-17, JOB-18).

The phone page has them too: its box can start a job now or schedule it
(every 30 minutes, every hour, or each day or weekday at a time, as a watch
if you like), and its Schedules list has Run now and Delete for each.

To have jobs reach your phone, install the ntfy app, subscribe to a long
random topic, and put it in the config as `"push": "https://ntfy.sh/<topic>"`
(or a ntfy server of your own); `navi push test` checks it, and prints a
random topic to use if there is none. A job waiting on you then arrives as an
urgent notification, and tapping it opens that job on the phone page when
navi serve runs with `--tailnet`. Anyone who knows the topic can read what is
sent, so a push says only what happened and the job's id; add
`"detail": true` (`"push": { "url": …, "detail": true }`) to include the
prompt and the command. With `detail` on, a push for a job waiting on you
also has Yes and No buttons that answer it right from the notification; each
carries a key good for that one question only, and your phone sends the
answer straight to navi over the tailnet. The token never leaves this
computer (`spec/push.md`).

A job waiting on a file change shows the changed lines in its notification
(the first six, cut short), and one waiting on a browser action the page it
is on, so you can answer from the lock screen; pushed, only with `detail`
(PSH-14, PSH-15).

`"quietHours": "22:00-07:00"` holds navi serve's notifications, on the Mac and
the phone, between those times; when they end you get one that sums up what
happened (how many jobs finished, failed or wait on you, the latest named).
A job waiting on you at night waits until you look (PSH-11 to PSH-13).

Changed your mind about what navi did to your files? `navi undo` (or
`/undo` at the `navi>` prompt) puts back every file its last turn in this
directory changed and removes the ones it made; run it again to go a turn
further back, up to ten. A file you have edited since is left alone and
named, and what shell commands did is not undone (it lists them). The model
is told on its next turn. `navi undo --list` shows what can be undone, and
`-C <directory>` reaches another directory. A job's changes are undone on
their own: its page on the phone lists the files it changed with an Undo
changes button, and `navi jobs <id> undo` does the same from the terminal
(`spec/undo.md`).
Undid too much? `navi redo` (or `/redo`) brings back what the last undo put
back, again leaving any file you have changed since; a change navi makes
after an undo ends what can be redone, as in an editor (UND-14 to UND-16).
In Raycast's Navi Chat, **⌘ Z** on the question undoes its file changes,
and the toast offers Redo (RAY-13, RAY-14).

navi remembers a few things about you between conversations. Tell it
something lasting ("remember I want temperatures in Celsius") and it offers
to keep it, asking `remember? …` first, always, whatever the judge would say,
so nothing a web page or file says can slip into what it is sent every turn.
The facts live in `~/.neoai/memory.md`, one per line, and you can edit it by
hand; `navi memory` lists them, `navi memory add "…"` adds one and
`navi memory forget <n | words>` removes one. They go wherever a turn goes,
a remote model included; `"memory": false` in the config turns it off
(`spec/memory.md`).

A project has facts of its own too: say "remember for this project: tests
run with make check" and navi asks `remember for <project>?`, then knows it
in every later turn in that repository, and nowhere else. They are kept in
`~/.neoai/memory/`, never in the repository; `navi memory` lists them after
yours, and `navi memory add --project "…"` adds one (MEM-14 to MEM-17).
The phone's What navi remembers page shows them too, for the projects of
the folders it offers jobs in, and can add or forget one (MEM-18, MEM-19).
On the phone page, What navi remembers shows the same list, with a box to
add a fact and a way to forget one (MEM-12, MEM-13).
When you leave a conversation of three or more answers with `exit`, navi
looks over what you typed (only that, not its answers or what it read) and
may suggest up to two facts, each asked about as usual; ^C skips it, ^C or
^D at the prompt leave at once, and `"suggest_memory": false` turns it off
(MEM-20 to MEM-22). On the phone, a finished job has an "Anything to
remember?" button that does the same over what you asked it, with a
Remember button on each suggestion; nothing is asked or kept untapped
(MEM-23, MEM-24).

`navi mcp` is navi as an MCP server: clients such as Claude Desktop, Claude
Code or Cursor get one tool, `ask_navi`, that hands a task (and any files) to
navi and your model in a directory they name. There is no one to say `y` over
MCP, so anything that would ask is declined (`spec/mcp.md`). To add it:

    claude mcp add navi -- navi mcp

or, in a client's JSON config, `{"command": "navi", "args": ["mcp"]}`.

navi has a browser of its own for pages `fetch_url` cannot read: ones behind
your logins, or drawn by scripts. Run `navi browser` once to open it (it
installs Chromium the first time) and sign in to the sites you want navi to
use; it is a separate window with its own profile in `~/.neoai/browser`, so
your everyday browser is never touched. navi reads pages as text, with a ref
on everything it can click or type into, and each action answers with what
changed on the page, so it never has to take screenshots or reread the page
to see what happened. Pages are read after their scripts run, and a task can
spread over several tabs, including ones a site opens itself. Opening and reading pages runs freely; clicking,
typing and choosing are judged like shell commands, and anything that could
send, buy, post, delete or change a setting asks you first (`do? … [y/N]`).
`"browser": false` in the config removes it (`spec/browser.md`).

    navi browser
    navi -p "what's on my GitHub notifications page"

navi starts every turn on your chain, usually a free model on your own
machine. Name a stronger one as `"escalate"` in the config (for example
`"escalate": "anthropic:claude-sonnet-5-5"`) and a turn that struggles (its
model call fails, three tool calls in a row fail, it runs out of steps, or it
gives no answer) carries on there, with everything done so far
(`spec/escalate.md`). Each turn also leaves a line of counts in
`~/.neoai/ledger.jsonl` (which model, how long, which tools, how it ended;
never what was said), and `navi stats` shows how each model has done
(`spec/ledger.md`; `"ledger": false` turns it off). When your next message
starts as a correction ("no, …", "that's wrong", "still doesn't work"), the
answer before it is counted as corrected against the model that gave it,
and `navi stats` shows each model's share (LED-7, LED-8); so is asking the
same thing again in other words ("25% asked again", LED-13, LED-14). An undo of a
turn's changes counts against the model that made them too: `navi stats`
shows the share of its edits you undid (LED-9, LED-10).

    navi stats

Add `"route": "ledger"` and navi learns from that record. Each turn is sorted
by its first words: asking for a change ("fix …", "add …"), sent with files,
or a question. When your first model has gone badly on more than half of
its last turns of that sort (at least 5 in the last 30 days: it escalated
away, failed or said nothing, or you corrected it, asked again or undid
what it did), the turn starts on the `"escalate"` model
instead, and navi says why (`· started on …`). It is off unless you set it,
since the escalation model may be a remote one. Turns routed past a model
don't count for or against it, so it gets another try once its bad turns
are a month old (ESC-6, ESC-7, LED-11, LED-15).

Each directory keeps its own conversation. `navi sessions` lists them, newest
first; `navi sessions clear` forgets this directory's, `clear <directory>`
another's, `clear --all` every one.
`navi sessions show [<directory>]` prints one as Markdown, prompts, answers
and the tools used between them, to read or keep:
`navi sessions show > notes.md` (`spec/session.md` SES-15 to SES-17).

When stdin is not a terminal (a pipe, a script) navi answers once and exits, so
it still composes: `echo | navi -p "summarize this"` prints one answer.

Tools: `grep`, `glob`, `read_file` (numbered lines, pageable), `list_dir`,
`write_file`, `edit_file`, `web_search`, `fetch_url`, `run_shell`, and the
browser's `browser_open`, `browser_tabs`, `browser_switch`,
`browser_close_tab`, `browser_read`, `browser_back`, `browser_click`,
`browser_type`, `browser_select` and `browser_press`. `web_search` needs no key
(DuckDuckGo); the query is the only thing it sends. `fetch_url` reads one page
as text and refuses this machine and the local network (`src/web.ts`).
`"web_search": false` in the config removes both; `"fetch_url": false` only the
latter. DuckDuckGo rate-limits bursts of searches; for steadier results set
`"search": { "searxng": "http://your-searxng:8080" }` (JSON output turned on)
or `"search": { "brave": "<Brave Search API key>" }` (or `BRAVE_SEARCH_API_KEY`),
asked first with DuckDuckGo as the fallback.
`grep` and `glob` use ripgrep when it is on PATH and a built-in search
otherwise (`src/search.ts`), honouring `.gitignore` either way, so nothing
needs installing.

`write_file` and `edit_file` show each change as a diff first. A new file in
the working directory is made without asking; changing an existing file, or
anything outside the directory, waits for `y` (`src/diff.ts`). `"write":
false` in the config removes both.

Before a shell command runs, the session's model is asked whether it is
safe — read-only, or writing new files inside the directory, nothing over the
network, no sudo. Safe commands run and are echoed as auto-approved; anything
else, or anything the judge cannot tell, shows the command and waits for `y`.
Whatever the judge says, a command that deletes, moves, overwrites, kills,
changes permissions, takes privileges or rewrites git history (`rm`, `mv`,
`>`, `sudo`, `git push`, …) always waits for you (`spec/tools.md` TL-44).
Answer `a` instead to run it and allow it from then on: it is added to
`"allow"` in the config, and that exact command runs without asking from
then on. An entry ending in ` *`, written by hand, also covers further
arguments: `"allow": ["git status", "npm test *"]` lets `npm test -- --watch`
run. A command that chains or redirects (`;`, `&&`, `|`, `>`, `$(…)`) is never
allowed this way.
`"approve": "ask"` in the config asks for everything else.

Which model answers is set by `model` in `~/.neoai/config.json`, or `--model`
for one run. A value is an alias — `local`, `fast`, `best`, or `remote` (a free
OpenRouter model) — or `<provider>:<model>` for a provider or custom endpoint,
`local:<id>` for a local model; a bare id with a slash is an OpenRouter model,
anything else a local one. A list is the fallback chain, tried in order:

    "model": ["anthropic:claude-sonnet-5-5", "local"]

Unset means `["local"]`: nothing leaves the machine until you choose a provider.
Each link resolves the backend it names or fails so the next is tried, and if
none resolve navi says so and exits 1. There is no keyless tier.

A link can have options of its own, keyed as the chain names it: a cap on
each answer, a temperature, or `think` to let a reasoning model think
(navi asks it not to otherwise). They apply to turns, jobs, escalation,
Raycast, and apps using `navi serve`, where a cap or temperature the app
sends itself wins (`spec/models.md`, MOD-24; SRV-9):

    "modelOptions": { "local": { "maxTokens": 4096, "temperature": 0.2 } }

An answer that stops at the cap, or the server's own, says it was cut short
(in the terminal, a job's log and Raycast); ask navi to go on (HAR-11). On
the phone, a cut job has a Go on button that does that for you (JOB-35).

Other flags: `-r` / `--resume` (open the loop with this directory's history),
`--max-steps N` (default 32).

Prompts leave the machine only for a provider or custom link; the backend that
answered is announced on stderr every run.

Conversation history is kept per directory under `~/.neoai/sessions/`, and
grows until it no longer fits the model; then the older part is summarised in
place by the model and the summary is what gets kept. A
prompt on the command line continues it, so a follow-up picks up where you
left off; bare `navi` starts fresh, and `navi -r` opens the loop with
the history. Another project's context never leaks in.

`./install.sh` puts a `navi` launcher in `~/.local/bin` that runs this
checkout through its own tsx (no Bun needed); piped from curl it clones the
repo to `~/.local/share/neoai` first. `--uninstall` removes only what it made.
It finishes with `navi setup --check`.

`navi setup` shows the primary and fallback models and lets you change
either, from Providers (a key is asked for hidden, checked, then saved; a few
hand-picked models in `src/providers.ts` of neorouter, then all of them), Local
(every model on running local servers, with help getting one) or Custom (any
OpenAI-compatible endpoint, checked by listing its models). `--check` only
reports, for scripts. The choices, checks and writes live in `src/setup-core.ts`
(`neonavi/setup`), which the Raycast jack-in drives too; `src/setup.ts` is only
the terminal.

The harness — system prompt, NAVI.md context, tools, judged shell approval,
compaction and the step loop — is a library, `neonavi/harness`
(`src/harness.ts`), and the CLI is one front end to it. A front end passes a
model (neorouter's `auto()`), its context window, a working directory and an
`approve(command)` callback to `createHarness`, opens a `session(history)`, and
iterates `session.turn(prompt, { signal })`: `text`, `tool-call`,
`tool-result`, `auto-approved`, `compacted` and `error` events, then `done`
with the history to store. The library never prints; the CLI turns the events
into its spinner, stderr echo and stdout answer, and the Raycast jack-in into
its views. See `spec/harness.md`.

Behaviour is specified in `spec/`, one file per area with numbered
requirements; change the spec before the code.
