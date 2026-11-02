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
- [x] Options per link: a token cap, a temperature, and leave to think,
      under `"modelOptions"`. (MOD-24, MOD-25)
- [x] Say why a link failed: unreachable, key refused, model gone, with the
      link named, in `navi`, `navi setup --check` and Raycast. (MOD-21)
- [x] The installer leaves `navi` runnable: it already warns when
      `~/.local/bin` is not on PATH; navi had simply never been installed here.
- [x] Cite spec ids from the existing tests so every requirement is traceable.
- [x] Local time by this computer's zone rules, not Node's bundled tzdata,
      which still had British Columbia on PST after its move to permanent
      UTC-7 (schedules were an hour late). (`spec/schedules.md` SCH-14)
- [x] A delete, overwrite, kill or privilege always asks, whatever the
      judge says: a local judge was seen auto-approving `rm README.md`
      because the user had asked for it. (`spec/tools.md` TL-44)
- [x] Tests for the requirements no test checked: the CLI end to end (on a
      pipe, and on a real terminal through script(1)), tool limits, local
      discovery, serve and mcp. Left: HAR-6 (structural) and RAY-1, RAY-5,
      RAY-8, which need Raycast running.

### 2. Daily driver: the agent I reach for first

- [x] `write_file` and `edit_file`, each change shown as a diff; a new file
      here is made without asking, any other change asks. (TL-36 to TL-40)
- [x] `/model` mid-session, without leaving the loop, and `/help`. (CLI-19 to CLI-21)
- [x] Image and PDF input: `-a`, `/attach`, and Raycast's Ask About Selected
      Files; images go to the model, PDFs as text. (HAR-7, HAR-8, CLI-22,
      CLI-23, RAY-11)
- [x] A PDF that is only scanned pages: its first 8 pages go as images,
      drawn with PDFKit on macOS. (HAR-7)
- [x] `navi sessions` lists per-directory histories; `navi sessions clear`
      forgets one or all. (SES-12 to SES-14)
- [x] Local first: a struggling turn escalates to `"escalate"`, keeping what
      was done. (ESC-1 to ESC-5)
- [x] A ledger of how each turn went, as counts, and `navi stats`. (LED-1 to LED-6)
- [x] The ledger notes an answer the user corrects next, by model only, and
      `navi stats` shows the share corrected. (LED-7, LED-8)
- [x] An undo counts against the model whose turn it undid; `navi stats`
      shows the share of edits undone. (LED-9, LED-10)
- [ ] Route by the ledger: start a kind of turn where it has gone well.
      (`spec/ledger.md` Open)

### 3. Everywhere: navi in the apps I already use

- [x] `navi serve`: an OpenAI-compatible local endpoint serving navi's model
      chain, with fallback, and `--install` to keep it running. (SRV-1 to SRV-8)
- [x] `navi mcp`: an MCP server whose `ask_navi` tool runs a navi turn.
      (MCP-1 to MCP-5)
- [x] Jobs in navi serve: started, followed and approved from the terminal
      (`navi job`, `navi jobs`) or a phone over Tailscale (`--tailnet`), kept
      across restarts, with macOS notifications. (JOB-1 to JOB-13)
- [x] Jobs on a schedule: at a time of day on chosen days, or every so
      often; skipped while the last is busy, missed runs made up once.
      (SCH-1 to SCH-8) The prompt now carries today's date. (PRM-13)
- [x] Push to the phone through ntfy when a job waits or ends, tapping
      through to the job; only the job id leaves unless `detail`. (PSH-1 to PSH-6)
- [x] Answer Yes or No from the notification itself, with a one-time key
      per approval instead of the token, and only when the push says what
      it allows. (PSH-7 to PSH-10)
- [x] Watches: `--only-changes` schedules compare with the last run that
      had news and stay silent when nothing changed. (SCH-9 to SCH-11)
- [x] Schedules on the phone page: made, listed, run now and deleted
      there. (SCH-12, SCH-13)
- [x] Edit a schedule in place: prompt, when, watch or not; from
      `navi schedules <id> edit` or the phone. (SCH-15 to SCH-18)
- [x] Pause and resume a schedule, from the terminal or the phone.
      (SCH-19 to SCH-21)
- [x] A schedule's last runs at a glance, as marks that open their jobs.
      (SCH-22 to SCH-24)
- [x] A schedule failing again and again pauses itself, with one
      notification. (SCH-25 to SCH-27)
- [x] A failed scheduled run is tried once more five minutes later before
      it counts. (SCH-28, SCH-29)
- [x] A waiting change's notification shows its changed lines; a browser
      action's, its page. (PSH-14 to PSH-16)
- [x] Quiet hours: notifications held overnight and sent as one summary.
      (PSH-11 to PSH-13)
- [x] navi serve's log shows this computer's time (it was an hour behind
      since BC's permanent UTC-7).
- [x] A running `navi serve` follows a changed config (endpoint, key,
      model) at its next job, with no restart. (`spec/models.md` MOD-23)
- [x] Files with a job: photos (scaled to JPEG on the phone, HEIC
      included) or any file from the phone page, `navi job -a` from the
      terminal, read as -a reads them. (JOB-14 to JOB-16)
- [x] Files with a follow-up: the phone page's follow-up box takes photos
      and files too, and `navi jobs <id> reply "…" -a <file>` follows a job
      up from the terminal. (JOB-19, JOB-20)
- [x] A queue: two jobs at once (`"jobsAtOnce"`), the rest `queued` in
      order and stoppable; one waiting on you holds no place. (JOB-21 to
      JOB-23)
- [x] A followed-up job's earlier turns: folded on the phone page, every
      turn with `navi jobs <id> show`. (JOB-27 to JOB-29)
- [x] Find a job by words in its prompt or answer: a box on the phone list,
      `navi jobs find <words>`. (JOB-30, JOB-31)
- [x] Repeat a finished job on a schedule, from the phone or
      `navi jobs <id> repeat`. (JOB-32 to JOB-34)
- [x] Delete a finished job, or clear them all, from the phone page or
      `navi jobs`; never one still working. (JOB-24 to JOB-26)
- [x] Answers on the phone page formatted from their Markdown (lists,
      tables, code, links), built as elements so nothing in an answer runs;
      only http(s) links. (JOB-17, JOB-18)
- [x] Memory: a short file of facts about you sent with every turn, added
      by the model only with your yes, whatever the judge says; `navi memory`
      lists, adds and forgets. (MEM-1 to MEM-11, PRM-14)
- [x] Memory on the phone page: see, add and forget facts (forgotten by
      exact text, never a near match). (MEM-12, MEM-13)
- [x] The phone page keeps saying why an action failed until the next one,
      instead of the refresh after it clearing it at once.
- [x] Memory per project: facts about one repository, asked for by name
      and sent only to turns there; kept in your home. (MEM-14 to MEM-17)
- [x] A project's facts on the phone: seen, added and forgotten for the
      projects navi serve offers. (MEM-18, MEM-19)
- [ ] Suggest facts to remember at the end of a conversation.
      (`spec/memory.md` Open)
- [x] Undo: `navi undo` and `/undo` put back the files navi's last turn
      changed, never over edits made since, and the model is told.
      (UND-1 to UND-9)
- [x] Undo a job's changes from the phone page (Undo changes) or
      `navi jobs <id> undo`, leaving other jobs' alone. (UND-10 to UND-13)
- [x] `navi sessions show` prints a saved conversation as Markdown, tools
      a line each, navi's own notes as quotes. (SES-15 to SES-17)
- [x] Redo: `navi redo` and `/redo` bring back what an undo put back, never
      over a change made since; the model is told. (UND-14 to UND-16)
- [ ] Undo from Raycast. (`spec/undo.md` Open)
- [x] navi's own browser: a separate Chromium with its own logins, read as
      text with refs (never screenshots), each action answering with what
      changed; reading is free, acting is judged and asked. (BRW-1 to BRW-15)
- [ ] The browser in Raycast: approval is ready, but Raycast's bundler
      cannot pack Playwright. (`jackins/raycast/spec.md` Open)
- [ ] The browser over MCP, with the client's own approval for actions.
      (`spec/browser.md` Open)

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
