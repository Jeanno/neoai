# TODO

Ordered by what would change day-to-day use the most, in the three tracks set
in the root `NAVI.md` (Direction). Each item names the spec file it would touch;
add the requirement there first.

## Next

### 1. Dependable: no configuration holds when things change

- [x] A pinned model the server no longer offers: a custom endpoint that
      now lists one model answers with it and says which pin is gone.
      (Seen for real: Darkbloom moved from Qwen3.8 to qwen3.6 and navi found
      no model.) (`spec/models.md` MOD-19, `spec/setup.md` SET-1)
- [x] A custom endpoint on this machine (Darkbloom on its Tailscale address)
      is described as on this computer, not REMOTE. (`spec/models.md` MOD-20)
- [x] Say why a link failed: unreachable, key refused, model gone, with the
      link named, in `navi`, `navi setup --check` and Raycast. (MOD-21)
- [ ] The installer leaves `navi` runnable: warn when `~/.local/bin` is not
      on PATH and print the line to add. (`spec/setup.md`)
- [ ] Cite spec ids from the existing tests so every requirement is traceable.
      (`test/*.test.ts`)

### 2. Daily driver: the agent I reach for first

- [ ] A write/edit tool, approved like `run_shell`. (`spec/tools.md`)
- [ ] `--model` or `/model` mid-session, without leaving the loop. (`spec/cli.md`)
- [ ] Image and PDF input: attach files to a turn (CLI path argument,
      Raycast selected Finder files); images go to vision models, PDFs as
      extracted text. (`spec/harness.md`, `spec/cli.md`,
      `jackins/raycast/spec.md`)
- [ ] `navi --sessions` to list and clear per-directory history. (`spec/session.md`)

### 3. Everywhere: navi in the apps I already use

- [ ] An OpenAI-compatible local endpoint serving navi's model chain, so any
      app that takes a base URL gets the same model. (`jackins/`)
- [ ] An MCP server exposing navi's tools and harness. (`jackins/`)

## Done

- [x] Interactive `navi>` loop by default; pipe mode unchanged.
- [x] Model chain in `~/.neoai/config.json` with scoped fallback.
- [x] Spec directory.
- [x] Shell auto-approval by a model judge (safe runs, unsafe or unclear asks,
      `approve: "ask"` restores always-ask), bold prompt, spinner.
- [x] Unbounded history, compacted by summary when it outgrows the model.
- [x] The answer streams as it is generated; pipes still get exactly the answer.
- [x] `web_search` (keyless DuckDuckGo) and `fetch_url` (never the local
      network), each removable in config.
- [x] The harness as a library, `neonavi/harness`, with the CLI rebuilt on it.
- [x] The Raycast jack-in: Ask Navi, Navi Chat, Summarize, rewrite commands,
      Set Up Navi.
- [x] grep/glob without ripgrep, honouring `.gitignore`.
- [x] `navi setup`: primary and fallback from Providers, Local or Custom,
      one core shared with Raycast, and `--check`, run by the installer.
