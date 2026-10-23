# Setup

    navi setup [--check]

Gets someone with no model and no config to a working answer, without editing
JSON by hand. Everything it writes goes to `~/.neoai/config.json`.

- SET-23: Setup is one core with two front ends: `navi setup` in the terminal
  and the Raycast jack-in's Set Up Navi command (`jackins/raycast/spec.md`).
  The core owns every choice, check and write; a front end only presents them,
  so the two cannot drift apart.

## Status

- SET-1: Setup first resolves the configured chain (MOD-5) and reports either
  the model that would answer, with REMOTE when prompts leave the machine, or
  that nothing answers. A pin replaced under MOD-19 is named as gone.
- SET-2: `navi setup --check` only reports: it exits 0 when a model resolves,
  and otherwise prints how to get one (the next step of SET-27, then naming
  `navi setup`) and exits 1. It never asks anything.
- SET-3: `navi setup` with a non-terminal stdin behaves as `--check`.
- SET-24: The first status a front end shows on opening setup only looks at
  servers already running (MOD-18): opening setup never starts a local
  runtime. A runtime may be started once the user asks for it: checking Local
  again (SET-5), picking a model (SET-11) or the test question. `--check`
  resolves fully, since its exit code says whether navi would answer.
- SET-25: The model that answers is named model first: a local model by its id
  (the status adds "on this computer"), a provider or custom model as
  `<model> on <provider or endpoint name>`. A local server's app is never
  named (RAY-9).
- SET-27: When nothing answers, the core words the next step without naming
  any command; each front end adds how to open setup from it (SET-2 for the
  terminal, RAY-7 for Raycast).

## Slots

- SET-13: Setup shows the primary model (the chain's first link), the fallback
  (its second link, or none) and any later links, and says which one answers
  now. The user can change the primary or the fallback, then finish.
- SET-18: Changing a slot first offers three groups: Providers, Local and
  Custom. The fallback also offers "none", and never the primary's pick.
- SET-17: Picks are saved as `model: [primary, fallback]`, without the
  fallback when it is none. Links after the second are kept, after them. A
  local model is saved as `local:<id>`, a provider or custom model as
  `<name>:<model>` (MOD-4).
- ~~SET-14, SET-15, SET-16: one list of models grouped by source, hand-picked
  paid OpenRouter models, and ways to add a source.~~ Replaced by SET-18 to
  SET-22.

## Providers

- SET-19: Providers lists the providers of MOD-14 by name, marking those that
  already have a key.
- SET-6: Choosing a provider without a key asks for one, says where to get it
  (the provider's key page), reads it without echo, and checks it with the
  provider before saving it to `keys.<provider>`. A rejected key is not saved;
  when the provider cannot be reached the key is not saved either, and setup
  says why. A provider with a key can have it replaced.
- SET-20: With a key, setup lists a few hand-picked models for that provider
  (a list in code; one the provider no longer offers is not shown), then "All
  models…", the provider's live model list.

## Local

- SET-21: Local lists every model on the running local servers, by its id
  alone (SET-25), and "any local model (fastest)".
- SET-5: Local also offers help getting a model (LM Studio, Ollama), then
  checks again each time the user asks, until one is found or they go back.

## Custom

- SET-22: Custom lists saved custom endpoints and "Add an endpoint": a name, a
  base URL and an optional key, checked by listing the server's models before
  it is saved under `custom.<name>` (MOD-15). Choosing an endpoint lists its
  models.

## Choices

- ~~SET-4: Setup offers: a model on this computer, an OpenRouter key, a free
  hosted model, or quitting.~~ Replaced by SET-13 and SET-18.
- ~~SET-7: The free hosted model is only picked after a warning.~~ There is no
  keyless tier (MOD-6).
- ~~SET-8: When a choice needs a link the configured chain lacks, setup
  appends that link's alias.~~ Replaced by SET-17.

## Writing

- SET-9: Setup changes only the fields it sets (`model`, `keys.<provider>`,
  `custom.<name>`) and keeps everything else in the file. A file that is not
  valid JSON is left alone and setup stops with an error rather than overwrite
  it.
- SET-10: The config file is written with mode 0600, since it may hold a key.

## Finish

- SET-11: After a change, setup resolves the chain again, reports it as in
  SET-1 and SET-13, and asks the model that answers a one-line test question,
  showing the reply or the error. Then it shows the slots again.
- SET-26: Every check setup makes (the status, listing models, checking a key
  or an endpoint, looking for a local model, the test question) can be
  cancelled by the front end. A cancelled check saves nothing and reports
  nothing; Raycast cancels a view's check when the view is left (RAY-10).
- SET-12: Leaving at any point (EOF or ^C in the terminal, Escape in Raycast)
  writes nothing not already saved. `navi setup` exits 0 when a model answers
  and 1 otherwise.

## Open

- Editing links past the second.
- Offering to install LM Studio or Ollama.
- Removing a saved key or custom endpoint.
