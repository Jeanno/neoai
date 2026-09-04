# TODO

Ordered by what would change day-to-day use the most. Each item names the spec
file it would touch; add the requirement there first.

## Next

- [ ] Stream the answer as it is generated instead of printing it at the end.
      A reasoning model is silent for 5–10s per step today. (`spec/cli.md`)
- [ ] Cite spec ids from the existing tests so every requirement is traceable.
      (`test/*.test.ts`)
- [ ] Report the real context window for hosted models instead of 8192.
      (`spec/models.md`, neorouter `resolve.ts`)

## Later

- [ ] `--model` or `/model` mid-session, without leaving the loop. (`spec/cli.md`)
- [ ] A write/edit tool, approved like `run_shell`. (`spec/tools.md`)
- [ ] Summarise old history instead of dropping it at 20 messages. (`spec/session.md`)
- [ ] `navi --sessions` to list and clear per-directory history. (`spec/session.md`)
- [ ] Per-command approval allowlist for read-only shell commands. (`spec/tools.md`)

## Done

- [x] Interactive `navi>` loop by default; pipe mode unchanged.
- [x] Model chain in `~/.neoai/config.json` with scoped fallback.
- [x] Spec directory.
