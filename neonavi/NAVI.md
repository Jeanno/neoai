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
`write_file`, `edit_file`, `web_search`, `fetch_url` and `run_shell`. `web_search` needs no key
(DuckDuckGo); the query is the only thing it sends. `fetch_url` reads one page
as text and refuses this machine and the local network (`src/web.ts`).
`"web_search": false` in the config removes both; `"fetch_url": false` only the
latter.
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
Nothing is remembered between commands. `"approve": "ask"` in the config asks
for everything. Nothing writes to disk except a shell command that passed.

Which model answers is set by `model` in `~/.neoai/config.json`, or `--model`
for one run. A value is an alias — `local`, `fast`, `best`, or `remote` (a free
OpenRouter model) — or `<provider>:<model>` for a provider or custom endpoint,
`local:<id>` for a local model; a bare id with a slash is an OpenRouter model,
anything else a local one. A list is the fallback chain, tried in order:

    "model": ["anthropic:claude-sonnet-5-5", "local"]

Unset means `["local"]`: nothing leaves the machine until you choose a provider.
Each link resolves the backend it names or fails so the next is tried, and if
none resolve navi says so and exits 1. There is no keyless tier.

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
