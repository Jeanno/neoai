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

## Open

- Escalate sooner, or skip the first model, for kinds of turns the ledger
  (LED-1) says it does badly.
