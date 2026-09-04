# neonavi

`navi` — a command-line agent. Bare `navi` in a terminal opens a conversation
at a `navi>` prompt; `navi <what you want done>` answers that first and then
keeps the prompt open. Bare words, no quoting. Each turn runs a tool loop until
it has an answer, then prints it. `exit`, ^C or ^D leave.

    navi
    navi where is shell approval handled
    navi what changed in this file --model best

When stdin is not a terminal (a pipe, a script) navi answers once and exits, so
it still composes: `echo | navi summarize this` behaves as before.

Tools: `grep`, `glob`, `read_file` (numbered lines, pageable), `list_dir`, and
`run_shell`, which shows the command and waits for `y` every single time and
remembers nothing. Nothing writes to disk except a shell command you approved.

Which model answers is set by `model` in `~/.neoai/config.json`, or `--model`
for one run. A value is an alias — `remote`, `local`, `fast`, `best` — or an
exact model id; an id with a slash is an OpenRouter model, anything else a local
one. A list is the fallback chain, tried in order, so put the machine last:

    "model": ["stealth/ox-alpha", "local"]

Unset means `["remote", "local"]`. Each link resolves the backend it names or
fails so the next is tried, and if none resolve navi says so and exits 1.

Other flags: `--new` (forget this directory's history), `--max-steps N`
(default 32).

navi asks OpenRouter first when a key is configured, and falls back to a local
model when there is no key or no network. Prompts leave the machine on the
remote path; the backend that answered is announced on stderr every run.

Conversation history is kept per directory under `~/.neonavi/sessions/`, so a
follow-up continues where you left off and another project's context never
leaks in.
