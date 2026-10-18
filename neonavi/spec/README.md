# neonavi spec

The spec is the source of truth for what `navi` does. Code and tests follow it.

## Layout

| File | Covers |
|---|---|
| `cli.md` | Invocation, flags, interactive loop, exit codes |
| `models.md` | Model chain: config, aliases, resolution, fallback |
| `prompt.md` | What the model is told before every turn |
| `tools.md` | The six tools, their limits, and shell approval |
| `session.md` | Per-directory history |
| `context.md` | NAVI.md discovery |
| `setup.md` | `navi setup`: getting a first model working |

## Requirements

Every requirement has an id, `AREA-N`, and is one testable sentence. MUST is
binding. SHOULD is the default unless a comment in code says why not.
Numbers are never reused: a dropped requirement is struck through, not deleted.

## Workflow

1. Change the spec first. A PR that changes behaviour without touching `spec/`
   is incomplete.
2. Add or change the test, citing the id in the test name or a comment.
3. Change the code.

Open questions and not-yet-built ideas live under `## Open` at the bottom of
each file, without ids, so they are never mistaken for behaviour.
