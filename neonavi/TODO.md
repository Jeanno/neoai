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
- [x] The installer leaves `navi` runnable: it already warns when
      `~/.local/bin` is not on PATH; navi had simply never been installed here.
- [x] Cite spec ids from the existing tests so every requirement is traceable.
- [ ] Tests for the 20 requirements no test checks yet: CLI-2 to CLI-7,
      CLI-9 to CLI-11, CLI-13 to CLI-15, CLI-18, CTX-3, HAR-6, MOD-16, PRM-6,
      PRM-7, RAY-1, RAY-5, RAY-8, SET-3, TL-1, TL-17, TL-25. (`test/*.test.ts`)

### 2. Daily driver: the agent I reach for first

- [x] `write_file` and `edit_file`, each change shown as a diff; a new file
      here is made without asking, any other change asks. (TL-36 to TL-40)
- [x] `/model` mid-session, without leaving the loop, and `/help`. (CLI-19 to CLI-21)
- [x] Image and PDF input: `-a`, `/attach`, and Raycast's Ask About Selected
      Files; images go to the model, PDFs as text. (HAR-7, HAR-8, CLI-22,
      CLI-23, RAY-11)
- [ ] A PDF that is only scanned pages: render its pages as images for a
      vision model instead of refusing it. (`spec/harness.md`)
- [x] `navi sessions` lists per-directory histories; `navi sessions clear`
      forgets one or all. (SES-12 to SES-14)

### 3. Everywhere: navi in the apps I already use

- [x] `navi serve`: an OpenAI-compatible local endpoint serving navi's model
      chain, with fallback, and `--install` to keep it running. (SRV-1 to SRV-8)
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
