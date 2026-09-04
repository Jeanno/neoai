# CLI

    navi [prompt words...] [--new | --resume] [--model <spec>] [--max-steps N]

## Prompt

- CLI-1: Everything in argv that is not a recognised flag is the prompt, joined
  by single spaces. No quoting is needed.
- CLI-2: Flags may appear anywhere in argv. `--new` and `--resume` are bare;
  `--model` and `--max-steps` take the next argument.

## Modes

- CLI-3: When stdin is a terminal, navi is interactive: after answering the
  argv prompt (if any) it reads further prompts from a `navi>` prompt until told
  to leave.
- CLI-4: When stdin is not a terminal, navi answers the argv prompt once and
  exits.
- CLI-5: With no argv prompt and a non-terminal stdin, navi prints usage to
  stderr and exits 1.
- CLI-6: With no argv prompt and a terminal stdin, navi starts a new session
  (SES-3), prints a one-line hint on how to leave, then opens the prompt.
- CLI-7: `exit`, `quit`, `q` (case-insensitive), ^C at the prompt, or EOF all
  leave with exit 0. Blank lines are ignored.
- CLI-8: The interactive prompt and shell approval share one stdin reader, so
  input typed ahead is never lost and never read by the wrong question.

## Turns

- CLI-9: One turn is one `generateText` call with tools, stopping after
  `--max-steps` steps (default 8). A step is one model response.
- CLI-10: Each tool call is echoed to stderr, dimmed, as it happens.
- CLI-11: The answer goes to stdout. Everything else — backend announcement,
  tool echo, hints, errors — goes to stderr, so stdout can be piped.
- CLI-12: An empty answer prints a dim hint on stderr. In one-shot mode this
  exits 1; in interactive mode the loop continues.
- CLI-13: History is saved after every turn, empty answer or not.

## Feedback

- CLI-16: While a model call is in flight and stderr is a terminal, a dim
  spinner animates on stderr. It is erased before any tool echo, approval
  prompt, or answer, so nothing it drew survives in the output.
- CLI-17: When stderr is not a terminal the spinner writes nothing at all.

- CLI-18: On a terminal the `navi>` prompt and the line typed after it are
  bold, and the style is reset before anything else is printed, so the user's
  turns stand out from the model's.

## Startup

- CLI-14: If no link in the model chain resolves, navi names the chain on
  stderr and exits 1 before reading any prompt.
- CLI-15: The resolved backend and model are announced once on stderr, with
  REMOTE called out when prompts leave the machine.

## Open

- Streaming output within a turn.
- A way to change the model mid-session.
