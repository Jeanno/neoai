# TODO

Ordered by what would change day-to-day use the most. Each item names the spec
file it would touch; add the requirement there first.

## Next

Shell auto-approval, prompt highlight, spinner. Decided: the session's model
judges each command; safe ones run unprompted, unsafe or unclear ones fall back
to `run? [y/N]`; the judge sees the command and the current prompt; `approve:
"ask"` in config restores always-ask. Ruled out: a `--yes` flag, a static
allowlist, refusing unsafe commands outright, a separate judge model.

1. [x] Spinner on stderr while a model call is in flight, terminal only,
       cleared before any tool echo or answer. Pipe mode prints nothing.
       (`spec/cli.md`)
2. [x] Render the `navi>` prompt and the typed line bold. (`spec/cli.md`)
3. [x] `judge(model, command, intent)` → safe | unsafe | unknown as a pure
       function, unit-tested with a fake model; anything unclear is unknown.
       No behaviour change. (`spec/tools.md`)
4. [x] Wire the judge into approval: safe runs, unsafe/unknown asks, closed
       stdin still declines. Add `approve: "ask"`. Depends on 3.
       (`spec/tools.md`, `spec/models.md`)

- [ ] Stream the answer as it is generated instead of printing it at the end.
      A reasoning model is silent for 5–10s per step today. (`spec/cli.md`)
- [ ] Cite spec ids from the existing tests so every requirement is traceable.
      (`test/*.test.ts`)

## Later

- [ ] `--model` or `/model` mid-session, without leaving the loop. (`spec/cli.md`)
- [ ] A write/edit tool, approved like `run_shell`. (`spec/tools.md`)
- [ ] `navi --sessions` to list and clear per-directory history. (`spec/session.md`)

## Done

- [x] Interactive `navi>` loop by default; pipe mode unchanged.
- [x] Model chain in `~/.neoai/config.json` with scoped fallback.
- [x] Spec directory.
- [x] Shell auto-approval by a model judge, bold prompt, spinner.
- [x] Unbounded history, compacted by summary when it outgrows the model.
