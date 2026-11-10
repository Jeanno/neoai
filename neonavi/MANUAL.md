# navi manual

navi is a command-line AI agent. It works in the directory you run it in: it searches and
reads files, changes files (showing each change as a diff), runs shell commands (asking
first unless judged safe), searches the web, reads pages and drives a browser of its own.

## Starting and asking

- `navi` in a terminal starts a new conversation at a `navi>` prompt.
- `navi -p "what you want done"` asks that, continuing this directory's saved conversation,
  then keeps the `navi>` prompt open.
- `navi -r` (or `--resume`) opens the prompt with this directory's saved conversation.
- When stdin is not a terminal (a pipe, a script), navi answers the `-p` prompt once and
  exits. Only the answer goes to stdout; the model announcement, tool calls, hints and
  errors go to stderr. With no `-p` and no terminal, it prints usage and exits 1.
- Bare words are not a prompt: `navi fix the bug` is an error; use `navi -p "fix the bug"`.
- `--once` with `-p` on a terminal answers, then exits. Exit status: 0 answered, 130
  stopped with ^C, 1 no answer.
- `-n` (or `--new`) starts with no conversation and saves none; the directory's saved one is
  neither read nor changed. Not with `--resume`.
- `--session NAME` keeps the conversation under that name, from any directory. Not with
  `--new`.
- `--max-steps N`: model responses per turn (default 32).
- `--model SPEC`: another model chain for this run (see Models).
- `navi -h`, `navi --help` or `navi help` prints usage and what each form does.
- Asked from neosh, an answer that ends with one command in a `sh` block puts it at your
  next prompt. Only a command that runs as it stands goes there: never a placeholder
  (`<file>`, `your-command-here`) or what a command printed, and its first word must be a
  builtin, a path or a program on your PATH. Tool calls are said in words beside the answer
  (`· read app.py`, `· click button "Sign in"`).

Examples:

    navi -p "where is shell approval handled"
    navi -p "what changed in this file" --model best
    navi -a screenshot.png -p "what is this error"
    git diff | navi -a - -p "write a commit message"

### At the prompt

- Leave with `exit`, `quit` or `q`, ^C at an empty prompt, or ^D. `exit` and `quit` may first
  offer facts to remember (see Memory); ^C and ^D leave at once.
- ^C while navi answers stops it: what was said is kept, `· stopped` is printed, and the
  prompt comes back. ^C with text typed clears the line.
- A pasted block of lines is one prompt.
- Up and down recall earlier prompts; the last 500 are kept in `~/.neoai/history`. A line
  starting with a space is not kept, nor are answers to approvals or keys.
- The answering model is announced on stderr, with REMOTE when prompts leave this computer.

## Attaching files

- `-a FILE` or `--attach FILE` (repeatable) sends files with the `-p` prompt, or with the
  first prompt typed. At the prompt, `/attach <file>` does the same for the next message;
  you can drag a file into the terminal.
- `-a -` attaches what is piped in, as a text file named `stdin`. Nothing piped can then
  answer an approval, so anything that needs one is declined.
- An image (PNG, JPEG, GIF, WebP) is sent as an image, scaled to at most 1600 pixels on its
  longer side. A PDF is sent as its text; a scanned PDF as images of its first 8 pages, on
  macOS. Any other text file is sent as text, cut at 100,000 characters.
- Refused, before any model is contacted: a missing file, a directory, a file over 50 MB,
  an image still over 20 MB after scaling, or a file that is not one of those kinds.

## Commands at the navi> prompt

| Command | What it does |
|---|---|
| `/model` | Shows the model answering and the saved chain |
| `/model <spec>` | Switches model for the rest of this session; nothing is saved |
| `/attach <file>` | Sends an image, PDF or text file with the next prompt |
| `/undo` | Puts back the files navi's last turn changed |
| `/redo` | Brings back what the last `/undo` put back |
| `/copy` | Copies the last answer to the clipboard |
| `/copy code [n]` | Copies the last (or n-th) code block, without fences |
| `/retry` | Asks the last prompt again, on the model answering now |
| `/save <file>` | Saves the last answer to a file (asks before overwriting) |
| `/save code [n] <file>` | Saves the last (or n-th) code block to a file |
| `/help` | Lists these commands |

- `/model <spec>` takes what `--model` takes. If nothing in it answers, each link's reason is
  printed and the current model stays.
- `/copy` uses pbcopy (macOS), wl-copy, xclip or xsel (Linux), clip (Windows); over SSH it
  copies to the computer you sit at.
- `/retry` replaces the last turn: the model never sees the old answer. `/model best` then
  `/retry` asks a better model. Shell commands are not undone. If the turn changed files
  still as it left them, `/retry` says to `/undo` first.

## Models and setup

### navi setup

- `navi setup` shows the model, the backup and any later links, and says which answers now.
- Its first screen is one numbered list of everything navi can answer with: **On this
  computer** (models on running LM Studio or Ollama servers, "any local model (fastest)", and
  help getting one), **With your API key** (Anthropic, OpenAI, Gemini, OpenRouter and the
  rest) and **Your own server** (any OpenAI-compatible URL with its key: saved ones, "Add a
  server", "Remove a server"). Pick a number to use it as the model; `b` opens the same list
  for the backup, which also offers none.
- A provider without a key asks for one, hidden, and checks it before saving, then lists its
  models. "Add a server" asks a name, base URL and optional key, and checks it.
- To use your own API URL and key as the model: `navi setup`, "Add a server", then its model.
- After a change, setup asks the model a one-line test question.
- A saved key can be removed from its provider's list, a server with "Remove a server" (one
  in use must be replaced as the model or backup first). A key set in the environment is not touched.
- `navi setup --check` only reports: exit 0 when a model answers, 1 otherwise, with the next
  step. Without a terminal, `navi setup` does the same. Leaving setup writes nothing more.
- Setup changes only `model`, `keys.<provider>` and `custom.<name>`, and stops rather than
  overwrite a config that is not valid JSON.

### Model specs

`model` in the config and `--model` take the same values: a string, a comma-separated
string, or a list.

- `local` or `fast`: the smallest usable local model. `best`: the largest local model that
  fits. `remote`: OpenRouter's free model with the largest context (kept for old configs).
- `<provider>:<model>`, such as `anthropic:claude-sonnet-5-5`: a model at a provider or a
  custom endpoint.
- `local:<id>`: a local model whose id contains `/` (`local:qwen/qwen3-4b`).
- A bare id containing `/` is an OpenRouter model; any other bare id is a local model.
- Unset means `["local"]`: nothing leaves the machine until you choose a provider or
  custom endpoint.

### Providers and keys

Providers: `openai`, `anthropic`, `google` (Gemini), `openrouter`, `groq`, `deepseek`,
`mistral`, `xai`. A key is read from its environment variable first, then `keys.<provider>`:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`.

### Local models and custom endpoints

- Local discovery looks at Ollama, LM Studio, llama.cpp, vLLM and Jan, and runtimes it can
  launch.
- Anything else, such as a server on another machine, is a custom endpoint:
  `"custom": { "<name>": { "baseURL": "...", "key": "..." } }` (key optional), named in the
  chain as `<name>:<model>`. The name cannot be a provider id or `local`.
- A custom endpoint at this computer's own address counts as local.
- If an endpoint's chosen model is gone and it now serves exactly one model, that one is
  used, and navi says so.

### Fallback chains

- A list is tried in order: `"model": ["anthropic:claude-sonnet-5-5", "local"]`. The first
  link that resolves is used for the whole run.
- A link never falls to something it does not name: a provider link never falls to a local
  model, and a local link never leaves the machine.
- A provider or custom link fails when its key is missing, the server cannot be reached, or
  the model is not listed. A local link fails when no server runs or can be launched, or the
  model is not installed.
- If no link resolves, navi lists each with why, suggests `navi setup`, and exits 1.
- A long-running navi (an open session, `navi serve`, `navi mcp`) tries a failed link again
  after 30 seconds, and looks afresh as soon as the config file changes.

### Options per model

`"modelOptions"` gives a link options, keyed as the chain names it:

- `maxTokens`: a default limit on each answer's tokens.
- `temperature`: 0 to 2.
- `think`: true lets a reasoning model think (navi asks local models and custom endpoints
  not to, by default).
- `tokenCap`: a hard ceiling no caller (navi, a job, an app through `navi serve`) gets past.

Example: `"modelOptions": { "local": { "maxTokens": 4096, "temperature": 0.2 } }`. Invalid
values are ignored. An answer that stopped at a limit says it was cut short; ask to go on.

### Escalation

- `"escalate": "<spec>"` names a stronger model for turns that struggle. Unset, nothing
  escalates.
- A turn struggles when its model call fails, three tool calls in a row fail, it uses every
  step still calling tools, or it ends with no answer. Stopping it or declining an approval
  does not count.
- The turn goes on once on the escalation model, with everything done so far. navi prints
  `· escalated to <model>: <reason>` (with REMOTE when it leaves the machine). The next turn
  starts on the chain again. The safety judge stays on the session's model.

### Routing by the ledger

- `"route": "ledger"` (with `escalate` set and the ledger on) starts a turn on the escalation
  model when your first model went badly on at least 5 of its last 10 turns of the same kind
  in the last 30 days.
- Kinds: asking for a change ("fix …", "add …"), sent with files, or a question.
- Went badly: escalated away, failed, no answer, or you corrected it, asked again, or undid
  its changes.
- navi says `· started on <model>` with why. Turns routed past a model don't count for or
  against it, so it gets another try once its bad turns are a month old. Off unless set.

## Approvals

### Shell commands

1. A command the allowlist names runs without asking.
2. Every other command goes to the safety judge (the session's model), which asks whether it
   serves what you asked and no more. Looking around (reading, searching, running tests or
   builds) is safe. A command judged safe runs, with a dim note saying auto-approved.
3. Anything else, or anything the judge cannot tell, shows the command and asks `[y/N/a]`.

- `y` runs it once.
- `a` runs it and adds it to `"allow"` in the config, so that exact command runs unasked from
  then on. Not offered for a command that chains or redirects.
- Anything else, Enter, or no input declines; the model is told not to retry it.

Whatever you asked, a command always asks (unless the allowlist names it) when it:

- takes privileges or changes the system (`sudo`, `su`, `dd`, `mkfs`, `diskutil`,
  `shutdown`, `launchctl`, `crontab`, `osascript`, `eval`, …);
- deletes, moves or writes outside the working directory (`rm ~/x`, `> ~/.zshrc`);
- deletes from a pipe (`… | xargs rm`) or pipes into `sh`, `bash` or `zsh`;
- force-pushes or rewrites history (`git push --force`, `git filter-branch`);
- looks malicious: a remote shell, running a downloaded script, a secret sent off the
  machine, `authorized_keys`, erasing shell history, deleting `.git`.

Commands time out after 120 seconds.

### The allowlist

`"allow": ["git status", "npm test *"]` lists commands that run without the judge or a
question, under any `approve` setting. An entry matches exactly; one ending in ` *` also
covers more arguments (`npm test *` allows `npm test -- --watch`). A command holding `;`, `&`,
`|`, `<`, `>`, a backquote, `$(` or a line break is never allowed this way.

### "approve": "ask"

`"approve": "ask"` skips the judge: every command the allowlist does not name asks, and so
does every file change and every browser action.

### Other things that ask

- Remembering a fact always asks. A browser upload always asks.
- A browser action that sends, buys, posts, deletes, signs in or out, or changes a setting
  asks `do? …`, answered only by `y`.

## File changes, undo and redo

- Each change navi makes with its file tools is shown as a diff first.
- A new file inside the working directory is made without asking. A change to an existing
  file there is judged with its diff: "fix the typo in README" just edits it; a change wider
  than you asked waits for `y`. A diff over 6,000 characters always asks.
- Always asks: anything outside the working directory; a hidden path (a part starting with
  `.`, such as `.github/workflows/…`); context files (`NAVI.md`, `CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`); files holding secrets (`.env…`, `.npmrc`, `.pem`, `~/.ssh/`, …).
- A path starting with `~` is in your home, as in a shell: `~/notes.md` is never a `~` folder
  here, and, being outside the working directory, it asks.
- Only `y` approves a file change; `a` is never offered. `"write": false` removes the tools.

Undo and redo:

- `navi undo` or `/undo` puts back every file the last turn in this directory changed and
  removes files it made. Again goes a turn further back, up to 10 turns.
- A file changed since (by you or anything else) is left alone and named. What shell
  commands did is not undone; undo lists them. Files over 1 MB cannot be undone.
- `navi undo --list` shows what can be undone. `-C <directory>` acts on another directory.
- `navi redo` or `/redo` brings back what the last undo put back, skipping files changed
  since. A new change by navi after an undo ends what can be redone.
- The model is told on its next turn. Nothing to undo or redo says so and exits 1.

## Sessions

- Each directory has its own conversation, in `~/.neoai/sessions/`; another directory never
  sees it. `navi -p` continues it (`· continuing (N messages)`), bare `navi` starts fresh,
  `navi -r` continues it.
- When history nears 70% of the model's context window, the older part is summarised in
  place (`· compacted N messages`).
- `navi sessions` lists them, newest first. `navi sessions show [<directory>]` prints one as
  Markdown (`navi sessions show > notes.md`). `navi sessions clear` deletes this directory's,
  `clear <directory>` another's, `clear --all` every one. `--json` lists them for programs.
- navi also reads every `NAVI.md` from the working directory up to the repository root (or
  home) as project context, cut at 8000 characters.

## Memory

- Facts about you live in `~/.neoai/memory.md`, one per line (`- fact`); you can edit it by
  hand. They go with every turn, to whichever model answers, a remote one included.
- Tell navi something lasting ("remember I want temperatures in Celsius") and it asks
  `remember? …` first, always.
- Project facts ("remember for this project: …") are kept in `~/.neoai/memory/`, never in
  the repository, and used only in that project.
- `navi memory` lists the facts, numbered. `navi memory add "<fact>"` adds one,
  `navi memory add --project "<fact>"` one for this project, and
  `navi memory forget <n | words>` removes one.
- A fact is one line of at most 300 characters; the facts are capped at 4000 characters.
- Leaving with `exit` or `quit` after 3 or more answers, navi may suggest up to two facts from
  what you typed (never its answers or what it read), each asked about; ^C skips.
  `"suggest_memory": false` turns that off; `"memory": false` turns memory off.

## Web search, web pages and the browser

- `web_search` uses DuckDuckGo, needs no key, sends only the query, and returns up to 8
  results. DuckDuckGo rate-limits bursts; for steadier results set
  `"search": { "searxng": "<base URL>" }` (JSON output on) or `"search": { "brave": "<key>" }`
  (or `BRAVE_SEARCH_API_KEY`). DuckDuckGo remains the fallback.
- `fetch_url` reads one http(s) page as text, sends only the URL, reads at most 2 MB, and
  refuses this computer and the local network.
- `"fetch_url": false` removes fetch_url. `"web_search": false` removes web search,
  fetch_url and the browser.

navi's browser is for pages behind your logins or drawn by scripts:

- It is a separate Chromium window with its own profile in `~/.neoai/browser`; your everyday
  browser is never touched.
- `navi browser` opens it so you can sign in to sites (installing Chromium the first time).
  `navi browser --install` installs or updates Chromium.
- `"browser": { "executable": "<path>" }` uses another browser; otherwise navi's Chromium,
  else Google Chrome.
- Opening, reading, going back, hovering and looking run freely. Clicks, typing and choices
  are judged; anything that could send, buy, post, delete or change a setting asks.
- navi never passes a "verify you are human" check: pass it yourself in navi's window, on the
  same tab. Downloads are saved in the working directory, never over an existing file.
- `"browser": { "look": false }` removes looking at a picture of the page (for a model that
  cannot take images). `"browser": false` removes the browser tools.

## navi serve

- `navi serve [--port N]` runs an OpenAI-compatible server on this computer only, at
  `http://127.0.0.1:8484/v1` by default. Give an app that base URL, any API key, and the
  model `navi`.
- A link that cannot be reached, or answers 429 or 5xx before replying, passes the request
  to the next link. With none answering, the reply is a 503.
- Requests from web pages are refused. Prompts and keys are never logged.
- `navi serve --install` (macOS) keeps it running from login, logging to
  `~/Library/Logs/navi-serve.log`; `--uninstall` removes it. A key only exported in your
  shell is not seen there; save it with `navi setup`.
- `--tailnet` also listens on this computer's Tailscale address, with a page for your
  phone. Every request there needs the token in `~/.neoai/serve-token`.

## Jobs and schedules

Jobs run in the background inside `navi serve`, so they go on after the terminal closes.

- `navi job "<prompt>"` starts one here (`-C <directory>` elsewhere, `-a <file>` for files).
- `navi jobs` lists jobs; `navi jobs <id>` shows one; `y` or `n` answers what it waits on;
  `stop`, `retry` (a failed or interrupted job), `show` (every turn), `undo`, `delete`.
- `navi jobs <id> reply "<follow-up>" [-a <file>]` follows one up.
- `navi jobs find <words>` searches; `navi jobs clear` deletes every finished job.
- `navi jobs <id> repeat --at 08:00` (or `--every 2h`) makes it a schedule.
- `navi jobs link` prints the phone page link. It holds the token: treat it as a key to this
  computer.
- Two jobs run at once (`"jobsAtOnce"` changes it); others wait as `queued`. Nothing is
  answered "always" from a job. If navi serve is not running, the commands say how to start it.

Schedules:

- `navi schedule "<prompt>" --at HH:MM [--days mon,tue,…]` (or `--days weekdays`), or
  `--every 30m` / `--every 2h` (5 minutes at least). `-C <directory>` sets where.
- `--only-changes` makes it a watch: runs with nothing new show as "nothing new" and send
  no notification.
- `navi schedules` lists them with the next run and marks for the last five: ✓ done,
  – nothing new, ✗ failed, ■ stopped, … working.
- `navi schedules <id> run | pause | resume | rm`, and `edit` with `--prompt`, `--at`,
  `--days`, `--every`, `--only-changes` or `--every-run`. A new time counts from the edit.
- A run due while the last is busy is skipped. Runs missed while navi serve was off are made
  up once, unless more than 12 hours late. A failed run is tried again 5 minutes later.
  Three failures in a row pause the schedule (`paused: failing`) and notify you once.

## Notifications and push

- On macOS a notification says when a job waits on you and when it ends.
  `"notify": false` turns it off; `"notify": "waiting"` keeps only what needs you.
- Push to a phone uses ntfy: `"push": "https://ntfy.sh/<long random topic>"`, or
  `{ "url": "…", "detail": true }`. Anyone who knows the topic can read it, so a push says
  only what happened and the job's id unless `detail` is true. With `detail` and
  `--tailnet`, a waiting job's push has Yes and No buttons.
- In `push`, `"notify": "waiting"` pushes only what needs you; `"notify": false` pauses it.
- `navi push test` sends a test push. `navi notify` shows the settings; `navi notify all`,
  `waiting` or `off` sets both, `navi notify mac off` or `navi notify phone waiting` one.
- `"quietHours": "22:00-07:00"` holds notifications and sends one summary when they end.

## MCP

- `navi mcp` makes navi an MCP server for clients such as Claude Code, Claude Desktop or
  Cursor, with one tool, `ask_navi` (a prompt, and optionally a directory and files).
- Add it with `claude mcp add navi -- navi mcp`, or `{"command": "navi", "args": ["mcp"]}`.
- No one can say `y` over MCP, so anything that would ask is declined.
- `navi mcp --browser` also offers navi's browser tools; the client's approval is the yes.

## The ledger, navi stats, and navi usage for cost

- Each turn adds a line of counts to `~/.neoai/ledger.jsonl`: when, the front end, the model,
  whether it stayed local, how long, steps, tools used, failed tool calls, declined
  approvals, prompt length in characters, files attached, how it ended, and tokens used.
- It never holds the prompt, the answer, tool inputs or outputs, file names, paths or URLs.
  `"ledger": false` writes nothing. Past 5 MB its older half is dropped.
- `navi stats [--days N]` (default 30) shows a line per model: turns, share answered, empty,
  failed and stopped, steps and tool errors per turn, median time, escalations, and the share
  of answers corrected or asked again and of edits undone. Lines by kind (changes, questions,
  with files) follow when there are several.

Tokens and cost:

- Each turn records the tokens the backend reported: in, out, and cached (the part of in read
  from the provider's cache).
- `navi usage [--days N]` (default 30) shows each model's turns, tokens (`120k in, 8k out`) and an estimated cost, most expensive first: `free`
  for a model on this computer; a dollar figure (`~$0.42`) for Claude models (direct or
  through OpenRouter) from navi's own price table, or for any model in `prices`;
  `price unknown` for other hosted models.
- A last line gives the estimated total, from list prices, and how many turns have no token
  counts (such as turns recorded before tokens were counted). It is an estimate, not a bill.

`prices` sets your own prices in US dollars per million tokens, keyed by the model id as the
ledger names it (without the provider part). `cached` takes `in`'s price when left out. Your
prices win over navi's table:

    "prices": { "claude-sonnet-5-5": { "in": 2, "out": 10, "cached": 0.2 } }

## Privacy

- By default (`["local"]`) nothing leaves this computer. Prompts leave only for a provider or
  a custom endpoint elsewhere, and navi announces REMOTE when they do.
- Memory facts and NAVI.md go with every turn to whichever model answers.
- web_search sends only the query, fetch_url only the URL; the browser visits pages as any
  browser does.
- The ledger keeps counts only, on this computer. A push says only status and job id unless
  `detail` is true.
- Files under `~/.neoai` (config, history, sessions, undo, ledger, memory, jobs) are readable
  by you only. The config may hold keys.

## Configuration: ~/.neoai/config.json

| Key | What it does |
|---|---|
| `model` | The model chain (see Model specs). Unset means `["local"]` |
| `keys.<provider>` | API key for a provider; the environment variable wins |
| `custom.<name>` | A custom endpoint: `{ "baseURL": "...", "key": "..." }` |
| `modelOptions` | Per-link `maxTokens`, `temperature`, `think`, `tokenCap` |
| `escalate` | Model spec for turns that struggle |
| `route` | `"ledger"`: start kinds of turns on the escalation model, by the record |
| `approve` | `"ask"`: skip the judge and ask for everything not allowed |
| `allow` | Commands that run without asking; ` *` at the end allows more arguments |
| `write` | `false` removes the file-changing tools |
| `web_search` | `false` removes web search, fetch_url and the browser |
| `fetch_url` | `false` removes only fetch_url |
| `search` | `{ "searxng": "<url>" }` or `{ "brave": "<key>" }`, asked before DuckDuckGo |
| `browser` | `false` removes it; `{ "executable": "<path>" }`; `{ "look": false }` |
| `memory` | `false` turns memory off |
| `suggest_memory` | `false` stops suggesting facts |
| `ledger` | `false` keeps no ledger |
| `prices` | Your own token prices for the cost estimate |
| `notify` | `false` or `"waiting"` for macOS job notifications |
| `push` | ntfy topic URL, or `{ "url", "detail", "notify" }` |
| `quietHours` | `"HH:MM-HH:MM"` holds notifications |
| `jobsAtOnce` | How many jobs run at once (default 2) |

Example:

    {
      "keys": { "anthropic": "sk-ant-..." },
      "custom": { "homelab": { "baseURL": "http://my-server:8000/v1" } },
      "model": ["anthropic:claude-sonnet-5-5", "local"]
    }

`navi setup` writes `model`, `keys` and `custom`; answering `a` adds to `allow`;
`navi notify` sets `notify` and `push.notify`; the rest is edited by hand. A running navi
picks up a new model, key or endpoint without a restart.

## Troubleshooting and common questions

**No model answers.** navi lists each link with why (no key, server not reached, key
refused, model not served or not installed, no local server). Run `navi setup` to choose a
model, or start your local server (Ollama, LM Studio) and try again.
`navi setup --check` says whether a model answers.

**Rate limits (429).** In the terminal the first link that resolves serves the whole run, so
a 429 is a failed model call; with `escalate` set the turn carries on there. Otherwise switch
with `/model <spec>` and `/retry`, or pick another primary in `navi setup`. `navi serve`
moves a request to the next link on 429 or 5xx. "Rate-limited" from search is DuckDuckGo:
set `search` to SearXNG or Brave.

**How much has this cost me?** `navi usage` (or `navi usage --days 7`); from neosh, `?/usage`. Local models are
free; hosted models without a price say `price unknown` (add them under `prices`). It is an
estimate from list prices.

**How do I change the model?** `navi setup` to save it; `--model <spec>` for one run;
`/model <spec>` for the rest of a session.

**How do I stop it asking?** Answer `a` to always allow that exact command, or add entries
to `"allow"`, such as `"npm test *"`. Commands that chain or redirect cannot be allowed; file
changes and facts still ask as described above. To make it ask about everything, set
`"approve": "ask"`.

**The answer was cut short.** It hit a token limit (`maxTokens`, `tokenCap` or the server's
own). Ask navi to go on.

**Undo what navi did.** `/undo` or `navi undo`. What shell commands did is not undone.

**Start fresh.** Bare `navi` starts a new conversation; `navi sessions clear` deletes this
directory's.

**Keep everything local.** Keep `model` local and add no providers; `"web_search": false`
keeps tools off the web.

**The browser does not start.** Run `navi browser --install`. A configured `executable` that
does not exist is reported, not replaced.

**Jobs say navi serve is not running.** Run `navi serve`, or `navi serve --install` on macOS.
