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
- NSH-5: navi answers in the terminal as the `navi` CLI does (`navi -p`), in
  the shell's directory, with its approvals, and gives the prompt back when
  it has answered (CLI-38). ^C stops it.
- NSH-6: navi is told the commands run in this shell since its last answer,
  up to the last 10, each with its directory and exit status (CLI-40), so
  "why did that fail" is about the right command.
- NSH-7: One shell session is one conversation with navi, whichever
  directory it is asked from (CLI-39); a new neosh starts a new one.
- NSH-8: A line sent to navi is kept in the shell's history as typed.
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

## Open

- Whether the git tree has changes, which needs reading the index.
- Telling navi a failed command's output: commands write straight to the
  terminal, so neosh sees only the status today.
- neosh as a login shell: an installer that adds it to `/etc/shells`, asked
  before it is.
