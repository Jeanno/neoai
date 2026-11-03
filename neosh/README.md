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
asking before it changes anything. When the answer is a command to run,
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

The prompt shows where you are, the git branch, and the status of a command
that failed, in red (`~/proj main 1 $`); set `PS1` in `~/.neoshrc` for your
own, and `NO_COLOR` for none.

## Try it

You need [Rust](https://rustup.rs) to build it and [navi](../README.md#navi-in-the-terminal)
on your `$PATH` to ask anything.

```bash
cd neosh
cargo build --release
./target/release/neosh
```

`neosh -c '…'`, `neosh script.sh` and commands on stdin work as in bash.
An interactive neosh reads `~/.neoshrc`; `-l` (or starting as `-neosh`)
also reads `~/.profile`. neosh does not add itself to `/etc/shells` or
change your login shell: try it from the shell you use now first.

```bash
cargo test
```
