# Tools

Nine tools. Nothing writes to disk except a shell command or a file change
that was approved. Only web_search, fetch_url and the model itself send
anything off the machine.

## Limits

- TL-1: Any tool result longer than 8000 characters is cut there and marked
  `…[truncated]`.
- TL-2: grep and glob return at most 100 hits and say how many were dropped.
- TL-3: read_file returns at most 400 lines per call.

## grep / glob

- ~~TL-4: Both use ripgrep.~~ Replaced by TL-31.
- TL-31: Both honour `.gitignore` and skip hidden files. They use ripgrep when
  it is installed and a built-in search otherwise, with the same results, so
  neither needs anything installed.
- TL-5: `node_modules` and `.git` are always excluded, gitignore or not.
- TL-6: grep returns `file:line:text`. glob returns one path per line.
- TL-7: No match is a normal result ("no matches for …"), not an error.
- TL-8: `path` defaults to the working directory.

## read_file

- TL-9: Lines are numbered `N→text`, 1-based, so the model can cite them.
- TL-10: `offset` (first line) and `limit` (line count) page through a file.
- TL-11: Output is cut on a line boundary when either the line limit or the
  size limit is hit, and the tail says how many lines remain and which offset
  continues.

## list_dir

- TL-12: Returns the directory's entries, one per line.

## run_shell

- TL-13: A call the allowlist names runs (TL-41); every other call is judged
  first (see below), and anything not judged safe asks the user, showing the
  exact command. Only an "always" answer (TL-43) is remembered between calls.
- TL-14: Only a line reading `y` (case-insensitive, trimmed) approves, or `a`
  where "always" is offered (TL-43). Any other input, or no input at all
  (closed or redirected stdin), declines.
- TL-15: A decline returns a message telling the model not to retry and to try
  another approach.
- TL-16: Commands run through the shell with a 120s timeout. Output is stdout,
  else stderr, else "(no output)".
- TL-17: A failing command returns its stderr or error message as the tool
  result so the model can recover; it is never thrown.

## write_file / edit_file

- TL-36: `write_file(path, content)` creates a file, with any missing parent
  directories, or replaces an existing one whole.
- TL-37: `edit_file(path, old_text, new_text)` replaces `old_text`, which must
  occur exactly once in an existing file. Not found, found more than once, or
  no such file returns a message saying which (and, for several, to include
  more surrounding lines), never a throw, and changes nothing.
- TL-38: Every change is shown as a diff before it is made: the changed lines
  marked `-` and `+`, with up to 3 unchanged lines around them. The diff is
  never cut short, and control characters in it are shown as symbols, so what
  is approved is all of what is shown. Creating a new file inside the working
  directory is what TL-21 calls safe, so with judging on (TL-24) it runs
  without asking and is reported as auto-approved like a command (TL-22).
  Changing an existing file, or writing anywhere outside the working
  directory, always asks, and so does every change under `"approve": "ask"`.
  Only `y` approves (TL-14); a file change is never offered `a`. A path that leads out of the working directory
  through a symbolic link counts as outside. So does a hidden one, a name
  starting with `.` anywhere in the path (`.git/hooks/…`,
  `.github/workflows/…`, `.envrc`), which tools and shells run on their own,
  and a context file (`NAVI.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), which
  agents read into their instructions. When a link takes the path somewhere it
  does not say, the question names where it really lands. A path with control
  or invisible characters is refused unasked, and commands and summaries are
  shown with such characters as symbols, so nothing in them can redraw the
  question. A path that leads somewhere else by the time it is approved is not
  written. A file that changed, or appeared, while the question was open is
  not written; the model is told to read it again.
- TL-39: A decline returns a message telling the model not to retry it
  (TL-15). A change made returns the path and how many lines were added and
  removed.
- TL-40: `"write": false` in `~/.neoai/config.json` removes both tools.

## web_search

- TL-26: `web_search(query)` returns up to 8 results, each a title, URL and
  snippet, numbered so the model can cite them.
- TL-27: It needs no key: results come from DuckDuckGo's HTML endpoint. Ads
  are dropped and redirect links are unwrapped to the destination URL.
- TL-28: The query is the only thing sent. It is echoed like every tool call
  (CLI-10), so a search is never silent; it is not gated by approval, because
  it reads and writes nothing on the machine.
- TL-29: No results is a normal result ("no results for …"). A network error,
  timeout (10s) or blocked request returns a message saying search is
  unavailable, never a throw, so the model can answer without it. DuckDuckGo
  answering with its bot check (HTTP 202, or a page asking to confirm a
  human) is a blocked request, never "no results", and the message says it
  is rate-limited for now.
- TL-44: `"search"` in `~/.neoai/config.json` names a backend asked before
  DuckDuckGo: `{ "searxng": "<base URL>" }`, a SearXNG instance with JSON
  output on (its `/search?format=json`), or `{ "brave": "<key>" }`, the Brave
  Search API; `BRAVE_SEARCH_API_KEY` in the environment counts as the second.
  Their results are shown as in TL-26. When the backend fails or refuses,
  DuckDuckGo is asked instead, and a message from either names which
  backend could not be used and why. The query is still the only thing sent
  (TL-28), plus the key to Brave.
- TL-30: `"web_search": false` in `~/.neoai/config.json` removes web_search
  and fetch_url, for sessions where nothing but the model may leave the
  machine.

## fetch_url

- TL-32: `fetch_url(url)` reads one http or https page and returns its text:
  HTML is reduced to its title and readable text (scripts, styles and markup
  dropped, block elements kept as line breaks); plain text, Markdown, JSON
  and XML are returned as they are. Anything else, such as an image or a PDF,
  returns a message naming its type instead of its bytes.
- TL-33: It never reaches this machine or the local network: `localhost`,
  `.local` and `.internal` names, and loopback, private, link-local and
  unspecified IP addresses are refused, and so is a redirect to one.
  Redirects are followed at most 5 times.
- TL-34: The URL is the only thing sent. Like web_search it is echoed and not
  gated by approval (TL-28). A timeout (15s), an HTTP error or a refused
  address returns a message, never a throw. At most 2 MB is read; the result
  is cut as in TL-1.
- TL-35: `"fetch_url": false` removes only fetch_url.

## Allowlist

Commands the user has said always to run, so a daily `npm test` stops asking.

- TL-41: `"allow": ["npm test", "git status"]` in `~/.neoai/config.json`
  lists commands that run without the judge or a question, under any
  `approve` setting. A command is allowed when it is an entry exactly, or,
  for an entry ending in ` *` such as `"npm test *"`, what comes before the
  `*` followed by more arguments; and when it holds none of `;`, `&`, `|`,
  `<`, `>`, a backquote, `$(` or a line break. So `npm test -- --watch` is
  allowed by `npm test *` but not by `npm test`, and `npm test; rm -rf ~` by
  neither. Leading and trailing spaces and tabs are ignored.
- TL-42: An allowed command is reported like an auto-approved one (TL-22),
  saying it was allowed rather than judged.
- TL-43: Where a command is asked about, the user may answer "always": it
  runs, and is added to `allow` in `~/.neoai/config.json` exactly as shown,
  never as a ` *` entry (kept 0600, every other setting left as it was), for
  this and every later session. Saves made at once are all kept. When the
  file cannot be saved, the command is allowed for this session only, and
  the user is told so. A command
  that could never be allowed (TL-41) is not offered "always". The CLI takes
  `a` at its `[y/N/a]` prompt; file changes are never offered it.

## Safety judge

A model call that decides whether a shell command needs the user's approval.

- TL-22: A command judged `safe` runs without asking. A dim line on stderr
  says it was auto-approved, so the user still sees every command.
- TL-23: `unsafe` and `unknown` both fall to the `[y/N]` prompt, so a closed
  stdin still declines them (TL-14).
- TL-24: `"approve": "ask"` in `~/.neoai/config.json` skips the judge and
  asks for everything the allowlist does not name (TL-41). Any other value, or none, means judge first.
- TL-25: The judge uses the session's model. No separate model is configured.

- TL-18: `judge(model, command, intent)` returns `safe`, `unsafe` or
  `unknown`. `intent` is the user's current prompt, so "delete the build dir"
  makes `rm -rf build` judgeable.
- TL-19: The model is asked for a one-word verdict. Only a line reading
  exactly SAFE or UNSAFE (case-insensitive) counts; the last such line wins.
  Any other output is `unknown`.
- TL-20: A model error, timeout, or empty reply is `unknown`, never a throw.
- TL-21: Safe means read-only, or writing only inside the working directory
  without deleting or overwriting existing files, with no network sends, no
  privilege escalation, no process kills, and no git history rewriting or
  pushing. Everything else, including anything the judge cannot tell, is unsafe.
