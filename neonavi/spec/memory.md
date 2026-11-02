# Memory

What navi knows about you from one conversation to the next: a short file
of facts, read into every turn, that navi can add to only with your yes.

## The file

- MEM-1: Memory is `~/.neoai/memory.md`, one fact per line written as
  `- fact`. Any other non-blank line counts as a fact as written, so the file
  can be edited by hand. It is made with mode 0600 and replaced whole, never
  half-written.
- MEM-2: Every turn reads the file afresh and sends its facts after the rest
  of the system prompt, under a heading saying the user wrote or approved
  each one. A fact remembered in one conversation is known in every other
  from its next turn. No facts, no section.
- MEM-3: The facts sent are cut at 4000 characters and marked
  `…[memory truncated]`; adding stops before that (MEM-6).
- MEM-4: `"memory": false` in config.json turns memory off: nothing is read
  into turns and there is no remember tool. The file is left alone.
- MEM-5: Memory goes wherever the turn goes: to the local model, or to a
  remote one when the turn escalates (`escalate.md`) or the chain names one.

## remember

- MEM-6: The model has a `remember` tool taking one `fact`. A fact is one
  line of at most 300 characters with no control or invisible characters;
  a blank one, a duplicate (ignoring case and spacing), or one that would
  take the file past 4000 characters is refused with why, and nothing asks.
- MEM-7: Every addition asks the user, whatever the approval mode, the
  allowlist or the judge would say, so a web page or file the model read
  cannot plant a fact that is then sent with every turn. "always" is a plain
  yes. A declined fact is not written, and the model is told not to ask again.
- MEM-8: In a job the question waits in the job, as a command's does, shown
  as `remember: <fact>`.

## navi memory

- MEM-9: `navi memory` lists the facts, numbered, and the file's path.
- MEM-10: `navi memory add <fact>` adds one with the same checks as MEM-6,
  without asking: typing it is the yes.
- MEM-11: `navi memory forget <n>` removes the fact numbered n;
  `navi memory forget <words>` removes the one fact containing them, and
  lists the matches when there are several.

## On the phone

- MEM-12: navi serve answers, behind the jobs token (JOB-8): `GET /memory`
  (the facts, in order, and whether memory is off, MEM-4), `POST /memory`
  with `{ fact }` (added with the checks of MEM-6 and no question, as
  MEM-10: sending it is the yes; a 400 saying why not) and `POST
  /memory/forget` with `{ fact }` (the fact with exactly that text removed;
  a 404 when there is none, so a list that changed elsewhere cannot remove
  the wrong one). Each answers with the facts as they are now. Facts are
  never written to navi serve's log.
- MEM-13: The phone page has a What navi remembers page: the facts, each
  with a way to forget it after a confirm, a box to add one, a note that
  they go with every turn to whichever model answers, and when memory is
  off, that it is.

## A project's facts

- MEM-14: A project also has facts of its own, kept in the user's home at
  `~/.neoai/memory/<hash of the project's root>.md` as MEM-1 has them, never
  in the project, so nothing is written to a repository and a cloned one
  cannot bring facts with it. The project is the repository the working
  directory is in (the nearest directory above it with `.git`, not above
  home), or the working directory itself outside one; at home there is no
  project, as home's facts are the user's.
- MEM-15: Every turn in a project reads its facts afresh too, sent after the
  user's under a heading naming the project, cut at 4000 characters of their
  own as MEM-3. None, no section; `"memory": false` turns them off with the
  rest (MEM-4).
- MEM-16: `remember` takes `project: true` for a fact about the project, with
  the checks of MEM-6 against the project's facts, asked as MEM-7 as
  `remember for <project>: <fact>`. Outside a project it is refused without
  asking.
- MEM-17: `navi memory` lists the project's facts after the user's, numbered
  on from them so one number names one fact, with the file's path;
  `navi memory add --project <fact>` adds one to the project's; `forget`
  takes a number or words across both.
- MEM-18: `GET /memory` also answers `projects`: for each directory navi
  serve offers jobs (JOB-9), its project's root and facts, each project
  once and in that order, none for home. `POST /memory` and `POST
  /memory/forget` take `project`, one of those roots, to add to or forget
  from its facts as MEM-12 does the user's; any other project is a 400, so
  the phone cannot write facts for a project navi serve does not offer.
- MEM-19: The phone's What navi remembers page shows each project's facts
  under its name after the user's, each with forget, and the box to add one
  has a choice of whom it is about: the user, or one of those projects.

## Open

- Suggest facts at the end of a conversation instead of only when asked.
