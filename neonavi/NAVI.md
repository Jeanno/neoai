# neonavi

`navi` — a command-line agent. Bare `navi` in a terminal opens a conversation
at a `navi>` prompt; `navi -p "<what you want done>"` answers that first and then
keeps the prompt open, and bare words without `-p` work too. Each turn runs a
tool loop until
it has an answer, then prints it. `exit`, ^C or ^D leave.

    navi
    navi -p "where is shell approval handled"
    navi -p "what changed in this file" --model best

When stdin is not a terminal (a pipe, a script) navi answers once and exits, so
it still composes: `echo | navi -p "summarize this"` prints one answer.

Tools: `grep`, `glob`, `read_file` (numbered lines, pageable), `list_dir`,
`web_search` and `run_shell`. `web_search` needs no key (DuckDuckGo); the query
is the only thing it sends, and `"web_search": false` in the config removes it.

Before a shell command runs, the session's model is asked whether it is
safe — read-only, or writing new files inside the directory, nothing over the
network, no sudo. Safe commands run and are echoed as auto-approved; anything
else, or anything the judge cannot tell, shows the command and waits for `y`.
Nothing is remembered between commands. `"approve": "ask"` in the config asks
for everything. Nothing writes to disk except a shell command that passed.

Which model answers is set by `model` in `~/.neoai/config.json`, or `--model`
for one run. A value is an alias — `remote`, `local`, `fast`, `best` — or an
exact model id; an id with a slash is an OpenRouter model, anything else a local
one. A list is the fallback chain, tried in order, so put the machine last:

    "model": ["stealth/ox-alpha", "local"]

Unset means `["remote", "local"]`. Each link resolves the backend it names or
fails so the next is tried, and if none resolve navi says so and exits 1.

Other flags: `-r` / `--resume` (open the loop with this directory's history),
`--max-steps N` (default 32).

navi asks OpenRouter first when a key is configured, and falls back to a local
model when there is no key or no network. Prompts leave the machine on the
remote path; the backend that answered is announced on stderr every run.

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
either. It picks from every model on running local servers, OpenRouter's free
tier and a short hand-picked list of paid models (`PICKS` in `src/setup.ts`,
priced live, shown only with a key), and the keyless `free` tier. New sources
are added from the same list: a local server, an OpenRouter key (checked before
it is saved), or `free`, which is never in the default chain and only added
after a warning and an explicit yes. Local picks are saved as `local:<id>`.
`--check` only reports, for scripts.

Behaviour is specified in `spec/`, one file per area with numbered
requirements; change the spec before the code.
