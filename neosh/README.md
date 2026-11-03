# neosh

A shell, as bash, zsh and fish are, with navi inside it. Its language is
bash's, so your commands and scripts keep working; a line starting with `?`
goes to navi instead, which knows what you have just been running.

```
~/proj $ npm run build
… error TS2304: Cannot find name 'Foo'.
~/proj $ ? why did that fail
```

navi is told the commands you ran since it last answered, with where they ran
and how they ended, and answers in your terminal, in the shell's directory,
asking before it changes anything. To show navi what a command printed, its errors too, pipe it to `?`:

```
~/proj $ npm test | ? why does this fail
~/proj $ git log -5 | ?
```

When the answer is a command to run,
the next prompt starts with it typed out: press Enter to run it, change it
first, or clear it with ^C. Right after a command fails, `?` alone asks
navi why and how to fix it; otherwise it says how to ask. Every line
without a `?` is the shell's and runs as bash runs it, so Enter never does
anything bash would not. If you forget the `?` and a sentence comes back
`command not found`, the next prompt starts with `? ` and your sentence:
Enter asks navi, ^C clears it. All of a shell's conversation with navi is
one session, whichever directory you ask from; which model answers is said
with its first answer, and again only when it changes.

`NEOSH_ASK=sentences` (in `~/.neoshrc` or at the prompt) also sends a
sentence whose first word is no command straight to navi (`show me the big
files`); `NEOSH_ASK=off` sends nothing.

The interpreter is [brush](https://github.com/reubeno/brush)'s, a
bash-compatible shell in Rust: pipelines, redirections, here-documents,
functions, arrays, `[[ … ]]`, aliases, job control, bash's builtins and its
history expansion (`sudo !!`, `!$`, `^old^new`), and `cd` looks in `CDPATH`.
What neosh adds is specified in [spec.md](spec.md).

The prompt shows where you are, the git branch (with `*` when tracked files
have changes), how long a command took when
it was 5 seconds or more, and the status of one that failed, in red
(`~/proj main* 1m 4s 1 $`); navi is told the time too. Set `PS1` in `~/.neoshrc` for your
own, and `NO_COLOR` for none. History is kept in `~/.neosh_history`
(or the file `HISTFILE` names), so ↑ and ^R reach earlier sessions. The
window title shows the directory, or the command running; Terminal and iTerm
open a new tab in the same directory; and VS Code's terminal marks each
command.

## Install

You need [Rust](https://rustup.rs) to build it and [navi](../README.md#navi-in-the-terminal)
on your `$PATH` to ask anything. One line, no checkout needed:

```bash
curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/neosh/install.sh | sh
```

From a checkout, `./neosh/install.sh` builds the code you have. Either way
you get `neosh` in `~/.local/bin`; run the installer again to update, or pass
`--uninstall` to remove it (`… | sh -s -- --uninstall`). Then type `neosh`.

`neosh -c '…'`, `neosh script.sh` and commands on stdin work as in bash.
An interactive neosh reads `~/.neoshrc`; `-l` (or starting as `-neosh`)
also reads `~/.profile`. neosh does not add itself to `/etc/shells` or
change your login shell: try it from the shell you use now first. The
installer ends by saying how, for when you are ready.

```bash
cargo test
```

`cargo test` also drives neosh on a pseudo-terminal (`tests/drive.py`, which
needs python3) with a stand-in navi, end to end.
