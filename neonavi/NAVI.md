# neonavi

`navi <what you want done>` — a one-shot command-line agent. Bare words, no
quoting. It runs a tool loop until it has an answer, then prints it.

    navi where is shell approval handled
    navi what changed in this file --model best

Tools: `grep`, `glob`, `read_file` (numbered lines, pageable), `list_dir`, and
`run_shell`, which shows the command and waits for `y` every single time and
remembers nothing. Nothing writes to disk except a shell command you approved.

Flags: `--new` (forget this directory's history), `--model fast|best`,
`--max-steps N` (default 8).

navi asks OpenRouter first when a key is configured, and falls back to a local
model when there is no key or no network. Prompts leave the machine on the
remote path; the backend that answered is announced on stderr every run.

Conversation history is kept per directory under `~/.neonavi/sessions/`, so a
follow-up continues where you left off and another project's context never
leaks in.
