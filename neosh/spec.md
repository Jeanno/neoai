# neosh

A shell, as zsh, bash and fish are: it reads commands, parses them and runs
programs, pipelines and jobs itself, in one process. Its language is bash's,
so what you know and the scripts you have keep working. navi lives inside
it: a line starting with `?` goes to navi, which knows what you have just
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

- NSH-25: `cd` looks a relative directory up in `CDPATH` as bash does:
  each entry in turn (an empty one is `.`), the first holding the directory
  wins and its path is printed, and with none the directory is the current
  one's. A path starting `/`, `./` or `../`, or `.`, `..` and `-`, is never
  looked up. A directory that is not there says so as bash does
  (`cd: share: No such file or directory`, status 1).
- NSH-29: With `shopt -s autocd`, a line that is only the name of a
  directory and no command (`src`, `..`, `~/work`) runs `cd -- <it>`, said
  on stderr as bash says it; history keeps the line as typed.
- NSH-30: With `shopt -s cdspell` in an interactive neosh, a `cd` to a
  directory that is not there tries each part of the path with one
  character swapped, missing, extra or wrong (`cd ../bta` for `../beta`);
  a single such directory found is printed and gone to, as bash does.
- NSH-31: An interactive neosh sets `COLUMNS` and `LINES` to the terminal's
  size before each prompt while `checkwinsize` is on (as it is by default,
  as in bash 5), so scripts and `select` see the width.
- NSH-24: An interactive neosh expands history as bash does, before
  anything else reads the line, while `set -H` (`histexpand`, on by
  default) is: `!!` the last command, `!n` the n-th in `history`, `!-n` the
  n-th from last, `!text` the last starting with text, `!?text?` the last
  holding it; after one, `:0`, `:n`, `:n-m`, `:n*`, `:^`, `:$` or `:*`
  picks its words, and `!$`, `!^` and `!*` are the last command's.
  `^old^new` runs the last command with the first `old` made `new`. A `!`
  is left alone in single quotes, after `\`, before a space, `=`, `(` or a
  closing `"`, and in `$!` and `${!…}`. The expanded line is printed, then
  run, and is what history keeps; one naming no command says `event not
  found` (or `bad word specifier`, `substitution failed`) and runs nothing.

## navi

- NSH-4: A line starting with `?` goes to navi with the rest as its prompt
  (`? why did that fail`); `?` with anything but a space after it (`?*`,
  `?.txt`) is a glob, as in bash. Every other line is the shell's and runs
  as bash would run it: neosh never guesses that a command was meant for
  navi, so Enter always does what it does in bash.
- NSH-23: When a line typed as a command is not found (status 127) and reads
  as a sentence (NSH-17), the next prompt starts with `? ` and the line,
  so Enter asks navi instead, and ^C clears it. A suggestion from navi
  comes first. Nothing goes to navi without Enter.
- NSH-17: `NEOSH_ASK` says which lines go to navi, read for every line so
  setting it at the prompt or in `~/.neoshrc` counts at once: `marked` (the
  default) a `?` line and `| ?`; `off` none, so every line runs as a
  command; `sentences` also a line that reads as a sentence and whose first
  word is no command, alias, function, builtin or keyword. A sentence is
  three words or more, none starting with `-` and none holding `|`, `&`,
  `;`, `<`, `>`, `$`, `` ` ``, `=`, `(`, `)`, `*`, `[` or a path's `/`. With
  `sentences`, one starting with a command still goes to navi when it ends
  with `?`, unless that last word is a glob naming a file there (`ls a?`),
  or when its first word is `what`, `which` or `who` followed by a word
  such as `is`, `are`, `does` or `the` (`who am i` stays a command). Any
  other value is the default.
- NSH-19: With `NEOSH_ASK=sentences`, the first time in a session that a
  line goes to navi for reading as a sentence, without a `?`, neosh says so
  on stderr before navi answers, with how to run it as a command instead
  (`command why …`).
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
- NSH-28: A line for navi is a command like any other for `$?` and the
  prompt: its status is navi's, 0 when navi answered, 130 when ^C stopped
  it, 127 with no `navi` on `$PATH`, 126 when it could not be started, and 0 for `?` alone saying how to ask.
  So a failure shown before is cleared once navi has answered it, and
  `$?` after `? …` says how the asking went.
- NSH-21: Which backend and model answered is said with the first answer
  of a session and again only when it changes (MOD-28): a hosted provider
  taking over from a local model is always said.
- NSH-8: A line sent to navi is kept in the shell's history as typed.
- NSH-13: History is kept between sessions in `~/.neosh_history`, or in the
  file `HISTFILE` names when it comes with the environment; ↑ and ^R find
  lines from earlier sessions, and `history` lists them as bash's does.
- NSH-26: History keeps what bash's would, a line for navi too: with
  `HISTCONTROL` holding `ignorespace` (or `ignoreboth`) a line typed with a
  space first is not kept, so a secret can be kept out of
  `~/.neosh_history`; `ignoredups` (or `ignoreboth`) drops a line the same
  as the one before, and `erasedups` drops its earlier copies from what ↑
  goes through (the history file keeps what it already has).
  A line matching one of `HISTIGNORE`'s `:`-separated patterns (`*`, `?`,
  `[…]`, and `&` for the line before) is not kept either. A line not kept
  still runs, and is never written to the history file.
- NSH-27: History is as long as bash's: `HISTSIZE` lines in the shell
  (↑, `history`, `!n`) and `HISTFILESIZE` in the history file, oldest
  dropped first, both 500 when neither the environment nor `~/.neoshrc`
  sets them, as bash's are. A value below zero, or not a number, keeps
  everything; `HISTFILESIZE` is applied when the shell exits, a timestamp
  line (`HISTTIMEFORMAT`) going with its command.
- NSH-9: `?` alone says how to ask navi, unless the command just run
  failed: then it asks navi why, and how to fix it (NSH-20). With no `navi` on `$PATH`, a line
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
- NSH-22: When files git tracks have changes, staged or not, a `*` follows
  the branch (`~/proj main* $`). neosh asks git (`git status`, taking no
  locks, so it never gets in the way of a git command running beside it);
  with no git on `$PATH`, or no answer within a fifth of a second, the `*`
  is left out and the prompt is not held up. Untracked files are no change.
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

- Telling navi a failed command's output without `| ?`: commands write
  straight to the terminal, so neosh sees only the status.
- A prebuilt binary, so installing needs no Rust.
- History modifiers after a `:` (`:h`, `:t`, `:s/a/b/`, `:p`).
- Where brush is not bash yet (NSH-3), found by running both: `select`
  does not parse; `shopt -s globstar` makes `**/x` name paths that are not
  there; `coproc` can stop neosh with a bad file descriptor; `dirs` shows
  `/private/tmp` for `/tmp`. These are brush's to fix.
