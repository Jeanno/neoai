# Escalation

Local first: a turn starts on the configured chain (MOD-5), usually a free
model on this computer, and is handed to a stronger model only when it
struggles, without losing what was done.

- ESC-1: `"escalate": <spec>` in `~/.neoai/config.json` names the model to
  hand a struggling turn to, in the same form as `model` (MOD-1 to MOD-4),
  resolved the same way, the first time a turn needs it. Unset, nothing
  escalates.
- ESC-2: A turn struggles when its model call fails, when three tool calls
  in a row fail, when it uses every step (CLI-9) still calling tools, or
  when it ends with no answer. A turn the user stopped, or one where the
  user declined an approval, does not struggle on that account.
- ESC-3: A struggling turn goes on, once, on the escalation model: with
  everything the first model did so far, then a note to the new model saying
  the earlier one struggled and why, and a fresh step budget. The front end
  is told (an `escalated` event naming both models and the reason) before
  the new model's first words. A turn already on the escalation model, or
  one whose escalation model does not resolve, ends as it would have.
- ESC-4: Only that turn escalates: the next turn starts on the chain again.
  The judge (TL-18) and compaction (SES-8) stay on the session's model.
- ESC-5: The CLI says it on stderr: `· escalated to <model>: <reason>`, with
  REMOTE called out when the new model's prompts leave the machine (CLI-15).

- ESC-6: With `"route": "ledger"` in the config (and the ledger on), a turn
  starts on the escalation model when, in the last 30 days, the session's
  model has gone badly on more than half of its latest turns of the turn's
  kind (LED-11): of the last 10 that started on it and were not stopped,
  at least 5, where a turn went badly when it escalated away or ended with
  an error or no answer. The front end gets an `escalated` event with
  `routed` before anything else, which it shows as `started on <model>`
  with the reason (`by the ledger, <model> went badly on 3 of its last 5
  turns asking for a change`). The routed turn does not escalate again and
  gets no note of struggle; the ledger keeps it as escalated with `routed`,
  and such turns are not counted for or against the model they skipped, so
  it is tried again once its bad turns are older than 30 days. Unset, or with
  no escalation model that resolves, every turn starts on the chain.

- ESC-7: Routing (ESC-6) also counts as gone badly each answer of the
  model, of the turn's kind, that the user corrected, asked for again, or
  undid (LED-15), from the first of the latest turns it is judged by on;
  never more than those turns.

## Open

- Escalate sooner within a turn, not only start elsewhere, for a model the
  ledger says struggles.
