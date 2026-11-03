# neosh

A shell, as zsh, bash and fish are: it reads commands, parses them and runs
programs, pipelines and jobs itself, in one process. Its language is bash's,
so what you know and the scripts you have keep working. navi lives inside
it: a line in plain English goes to navi, which knows what you have just
been running.

neosh is written in Rust (`neosh/`), one binary. Its interpreter is
[brush](https://github.com/reubeno/brush)'s (`brush-core`, MIT), a
bash-compatible shell checked against bash by its own tests; neosh never
hands a line to another shell. What neosh adds is below.

## Starting

- NSH-1: `neosh` on a terminal is interactive: it reads `~/.neoshrc` if there
  is one, then prompts. `neosh -c '<commands>' [name [args…]]` runs the
  commands and exits with the last one's status; `neosh <file> [args…]` runs
  a script; with stdin not a terminal it reads commands from stdin. `-l`, or
  being started as `-neosh` (as a login shell is), reads `~/.profile` first.
- NSH-2: The exit status is the last command's, and `exit [n]` leaves with
  n. `--version` and `--help` say what neosh is and how to start it.

- NSH-14: `neosh/install.sh` builds neosh and puts it in `~/.local/bin`
  (`NEOSH_BIN_DIR`), from the checkout it is in or, piped from curl, a clone
  in `~/.local/share/neoai` shared with navi's installer. Run again, it
  updates; `--uninstall` removes it. It replaces or removes only a neosh,
  leaves history and `~/.neoshrc` alone, and never changes the login shell
  or `/etc/shells`: it says how.

## The language

- NSH-3: Everything bash's grammar has that brush runs: quoting, pipelines
  and lists, redirections and here-documents, `if`, `while`, `for`, `case`,
  functions, expansions, globs, aliases, arrays and `[[ … ]]`, job control
  (^Z, `jobs`, `fg`, `bg`), and bash's builtins. Where brush and bash differ,
  bash is right, and the difference is brush's to fix.

## navi

- NSH-4: A line starting with `?` goes to navi with the rest as its prompt
  (`? why did that fail`). So does a line whose first word is no command,
  alias, function, builtin or keyword and that reads as a sentence: three
  words or more, none holding `|`, `&`, `;`, `<`, `>`, `$`, `` ` ``, `=`,
  `(` or a path's `/`. A sentence starting with a command still goes to navi
  when it ends with `?`, or when its first word is `what`, `which` or `who`
  (programs on most systems) followed by a word such as `is`, `are`,
  `does` or `the` (`who am i` stays a command). Anything else runs as a
  command, so a typo is still `command not found`.
- NSH-19: The first time in a session that a line goes to navi for reading
  as a sentence, without a `?`, neosh says so on stderr before navi
  answers, with how to run it as a command instead (`command why …`) and
  `NEOSH_ASK`.
- NSH-17: `NEOSH_ASK` says which lines go to navi, read for every line so
  setting it at the prompt or in `~/.neoshrc` counts at once: `sentences`
  (the default) as above; `marked` only a `?` line and `| ?`; `off` none, so
  every line runs as a command. Any other value is the default.
- NSH-5: navi answers in the terminal as the `navi` CLI does (`navi -p`), in
  the shell's directory, with its approvals, and gives the prompt back when
  it has answered (CLI-38). ^C stops it and never the shell, from the
  first line of a session on.
- NSH-16: A command line ending in `| ?`, with a question or without
  (`npm test | ? why does this fail`), runs the command and hands navi what
  it printed, its errors too, with the question (or, alone, a request to
  explain it). The `|` and `?` count only outside quotes; `a || ? b` is no
  such line. navi answers as for any question (NSH-5 to NSH-7, NSH-11), and
  the line is kept in history as typed.
- NSH-6: navi is told the commands run in this shell since its last answer,
  up to the last 10, each with its directory and exit status (CLI-40), so
  "why did that fail" is about the right command. A command typed over
  several lines is told on one, each line break shown as ` ↵ `.
- NSH-7: One shell session is one conversation with navi, whichever
  directory it is asked from (CLI-39); a new neosh starts a new one.
- NSH-8: A line sent to navi is kept in the shell's history as typed.
- NSH-13: History is kept between sessions in `~/.neosh_history`, or in the
  file `HISTFILE` names when it comes with the environment; ↑ and ^R find
  lines from earlier sessions, and `history` lists them as bash's does.
- NSH-9: `?` alone says how to ask navi. With no `navi` on `$PATH`, a line
  for navi says so and how to install it, and runs nothing.

- NSH-11: When navi's answer ends with a command to run (CLI-41), the next
  prompt starts with it typed out, the cursor at its end: Enter runs it, as
  if typed, and it can be changed first or cleared with ^C. neosh never runs
  it by itself.

## The prompt

- NSH-10: The prompt is the directory, `~` for home, and `$` (`#` as root),
  unless `PS1` came with the environment or `~/.neoshrc` sets one.
- NSH-12: In a git repository the prompt also shows its branch, or the
  commit's short hash when none is checked out (`~/proj main $`), read from
  `.git` without running git. After a command that failed, it shows the
  status before the `$` (`~/proj main 1 $`), in red. Colour is left out
  when `NO_COLOR` is set.
- NSH-15: A command that took 5 seconds or more shows how long, in the next
  prompt before any status (`~/proj main 1m 4s 1 $`), and in what navi is
  told of it (`~/proj $ cargo build (exit 101, took 1m 4s)`).

## The terminal

- NSH-18: An interactive neosh tells the terminal, unless `TERM` is unset or
  `dumb`: the title is the directory while it waits and the command while
  one runs; the directory is reported (OSC 7), so Terminal, iTerm and others
  open a new tab there; and in VS Code's terminal, commands are marked with
  their status as its shell integration expects.

## Open

- Whether the git tree has changes, which needs reading the index.
- Telling navi a failed command's output without `| ?`: commands write
  straight to the terminal, so neosh sees only the status.
- A prebuilt binary, so installing needs no Rust.
