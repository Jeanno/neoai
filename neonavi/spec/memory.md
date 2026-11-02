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

## Open

- Suggest facts at the end of a conversation instead of only when asked.
- Per-project memory beside NAVI.md.
