# neosh

A shell, as bash, zsh and fish are, with navi inside it. Its language is
bash's, so your commands and scripts keep working; a line in plain English
goes to navi instead, which knows what you have just been running.

```
~/proj $ npm run build
… error TS2304: Cannot find name 'Foo'.
~/proj $ why did that fail
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
first, or clear it with ^C. Start a line with `?` to make sure it goes
to navi (`? ls or exa`); `?` alone says how. A typo such as `gti status`
stays `command not found`: a line goes to navi only when it reads as a
sentence and its first word is no command, or when it asks (`what is using
port 3000`, `find the big files?`). All of a shell's conversation with navi
is one session, whichever directory you ask from.

The interpreter is [brush](https://github.com/reubeno/brush)'s, a
bash-compatible shell in Rust: pipelines, redirections, here-documents,
functions, arrays, `[[ … ]]`, aliases, job control and bash's builtins.
What neosh adds is specified in [spec.md](spec.md).

The prompt shows where you are, the git branch, how long a command took when
it was 5 seconds or more, and the status of one that failed, in red
(`~/proj main 1m 4s 1 $`); navi is told the time too. set `PS1` in `~/.neoshrc` for your
own, and `NO_COLOR` for none. History is kept in `~/.neosh_history`
(or the file `HISTFILE` names), so ↑ and ^R reach earlier sessions.

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
