# Navi for Raycast

The Raycast jack-in. It is a front end to navi's harness (`neonavi/spec/harness.md`)
and to setup (`neonavi/spec/setup.md`); it adds only what Raycast needs.

## Harness

- RAY-1: Ask Navi, Navi Chat and Summarize answer through navi's harness, so
  they get navi's system prompt, tools, judge and limits. The working
  directory is `~/.navi-raycast`, created on first use: Raycast has no project
  to work in, and the judge's "writes only inside the working directory"
  (TL-21) then keeps unasked writes out of the home folder.
- RAY-2: Each tool call shows in the answer while it happens, as a short line
  above the text, and stays there once the answer is done.
- RAY-3: A shell command not judged safe pauses the answer and shows the
  command with Run Command and Don't Run actions. Leaving the view or stopping
  the answer declines.
- RAY-4: Chats are kept in Raycast's own storage and continued through the
  harness (HAR-3).
- RAY-5: Fix Spelling and Grammar and Translate and Replace use the model
  without tools: they only rewrite the selection.

## Setup

- RAY-6: A Set Up Navi command presents setup (SET-23) as Raycast views: the
  slots, then Providers, Local and Custom, with keys entered in a password
  field and endpoints in a form.
- RAY-7: When no model answers, every command says so and offers Set Up Navi
  as its primary action, instead of an error naming the chain. Below that,
  each link is listed with why it failed (MOD-21).
- RAY-8: Model choices are saved to `~/.neoai/config.json`, shared with the
  CLI. The extension has no model preference of its own.

## Words

- RAY-9: Nothing the extension shows names a product the user did not choose.
  Detected local servers appear by their models, not their app; a provider's
  name appears only in Providers and once the user has picked one of its
  models. The words come from setup's core (SET-25); the extension does not
  relabel them.
- RAY-10: Leaving a Set Up Navi view (Escape) cancels the check it started
  (SET-26), and opening Set Up Navi starts no local runtime (SET-24).

## Open

- Opening Set Up Navi automatically on first run.
