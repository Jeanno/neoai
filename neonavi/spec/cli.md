# CLI

    navi [-p <prompt>] [-a <file>]... [-r|--resume] [--model <spec>] [--max-steps N]
    navi setup [--check]
    navi sessions [clear [<directory> | --all]]

## Prompt

- CLI-1: `-p <text>` is the prompt. Bare words are not a prompt: anything in
  argv that is not a recognised flag is an error, reported with the usage line.
  The exceptions are `setup` as the first argument, which runs setup
  (`setup.md`), and `sessions`, which manages saved histories (SES-13,
  SES-14), each instead of a session.
- CLI-2: Flags may appear anywhere in argv. `--resume` and its short form `-r`
  are bare; `-p`, `--model`, `--max-steps` and `-a`/`--attach` take the next
  argument.
- CLI-22: `-a <file>` or `--attach <file>`, repeatable, attaches files
  (HAR-7) to the `-p` prompt, or to the first prompt typed when there is
  none. A file that cannot be attached is reported and navi exits 1 before
  resolving a model.

## Modes

- CLI-3: When stdin is a terminal, navi is interactive: after answering the
  `-p` prompt (if any) it reads further prompts from a `navi>` prompt until told
  to leave.
- CLI-4: When stdin is not a terminal, navi answers the `-p` prompt once and
  exits.
- CLI-5: With no `-p` prompt and a non-terminal stdin, navi prints usage to
  stderr and exits 1.
- CLI-24: `navi -h`, `--help` or `help` prints the usage and what each form
  does to stdout and exits 0. A `--max-steps` that is not a whole number of
  at least 1 is reported with the usage, exit 1.
- CLI-6: With no `-p` prompt and a terminal stdin, navi starts a new session
  (SES-3), prints a one-line hint naming `/help` and how to leave, then opens
  the prompt.
- CLI-7: `exit`, `quit`, `q` (case-insensitive), ^C at the prompt, or EOF all
  leave with exit 0. Blank lines are ignored.
- CLI-8: The interactive prompt and shell approval share one stdin reader, so
  input typed ahead is never lost and never read by the wrong question.

## Turns

- CLI-9: One turn is one harness turn (HAR-2) with tools, stopping after
  `--max-steps` steps (default 32). A step is one model response.
- CLI-10: Each tool call is echoed to stderr, dimmed, as it happens.
- CLI-11: The answer goes to stdout. Everything else — backend announcement,
  tool echo, hints, errors — goes to stderr, so stdout can be piped.
- CLI-12: An empty answer prints a dim hint on stderr. In one-shot mode this
  exits 1; in interactive mode the loop continues.
- CLI-13: History is saved after every turn, empty answer or not.

## Commands

- CLI-19: At the `navi>` prompt, a line that is exactly `/model`, or starts
  with `/model ` or `/attach `, or is `/help`, is a command, not a prompt.
- CLI-20: `/model` prints the model answering, as SET-1 words it, and the
  saved chain, with the session's own when `--model` or an earlier `/model`
  set one. `/model <spec>` takes what `--model` takes and switches to it for
  the rest of the session, keeping the conversation; nothing is saved. Its
  links are looked at afresh, so a server started since answers. When
  nothing in it answers, each link's reason is printed (MOD-21) and the
  current model stays.
- CLI-21: `/help` lists the commands and how to leave.
- CLI-23: `/attach <file>` attaches a file to the next prompt (HAR-7); it may
  be given more than once. A path may be quoted, or have its spaces escaped
  as a terminal's drag and drop writes them. A file that cannot be attached
  is reported and nothing is attached. `/attach` alone says how to use it.

## Feedback

- CLI-16: While a model call is in flight and stderr is a terminal, a dim
  spinner animates on stderr. It is erased before any tool echo, approval
  prompt, or answer, so nothing it drew survives in the output.
- CLI-17: When stderr is not a terminal the spinner writes nothing at all.

- CLI-18: On a terminal the `navi>` prompt sits on a lighter background, a
  gray block with bright text, and the line typed after it is bold. The style
  is reset before anything else is printed, so the user's turns stand out from
  the model's. A blank line follows the typed line.

## Startup

- CLI-14: If no link in the model chain resolves, navi lists each link on
  stderr with why it failed (MOD-21), suggests `navi setup`, and exits 1
  before reading any prompt.
- CLI-15: The resolved backend and model are announced once on stderr, with
  REMOTE called out when prompts leave the machine.

