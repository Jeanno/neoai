# Setup

    navi setup [--check]

Gets someone with no model and no config to a working answer, without editing
JSON by hand. Everything it writes goes to `~/.neoai/config.json`.

## Status

- SET-1: Setup first resolves the configured chain (MOD-5) and reports either
  the backend and model that would answer, with REMOTE when prompts leave the
  machine, or that nothing answers.
- SET-2: `navi setup --check` only reports: it exits 0 when a model resolves,
  and otherwise prints how to get one (naming `navi setup`) and exits 1. It
  never asks anything.
- SET-3: `navi setup` with a non-terminal stdin behaves as `--check`.

## Slots

- SET-13: Setup shows the primary model (the chain's first link), the fallback
  (its second link, or none) and any later links, and says which one answers
  now. The user can change the primary or the fallback; Enter finishes.
- SET-14: Changing a slot lists models grouped by source: each model on every
  running local server, and "any local model"; when an OpenRouter key is set,
  "any free OpenRouter model" and the hand-picked models (SET-15); and the free
  public model when the chain already uses it. The fallback list adds "none"
  and leaves out the primary.
- SET-15: The hand-picked OpenRouter models are a list kept in code, shown
  cheapest first with their live price per million tokens, under a note that
  they bill the key. One missing from the live catalogue is not shown.
- SET-16: The list ends with ways to add a source: a local model (SET-5), an
  OpenRouter key (SET-6) and the free public model (SET-7). After adding a
  local model or a key, the list is shown again with the new models in it;
  agreeing to the free public model picks it for the slot.
- SET-17: Picks are saved as `model: [primary, fallback]`, without the
  fallback when it is none. Links after the second are kept, after them. A
  local model is saved as `local:<id>` (MOD-4).

## Choices

- ~~SET-4: Setup offers: a model on this computer, an OpenRouter key, a free
  hosted model, or quitting.~~ Replaced by SET-13 to SET-16.
- SET-5: Adding a local model shows how to get one (LM Studio, Ollama), then
  checks again each time Enter is pressed, until one is found or the user goes
  back.
- SET-6: An OpenRouter key is read without echo and checked against OpenRouter
  before it is saved. A rejected key is not saved; when OpenRouter cannot be
  reached the key is not saved either, and setup says why.
- SET-7: The free hosted model is only picked after a warning that prompts and
  files navi reads go to a public service, and an explicit `y`.
- ~~SET-8: When a choice needs a link the configured chain lacks, setup
  appends that link's alias.~~ Replaced by SET-17.

## Writing

- SET-9: Setup changes only the fields it sets (`model`, `keys.openrouter`) and
  keeps everything else in the file. A file that is not valid JSON is left
  alone and setup stops with an error rather than overwrite it.
- SET-10: The config file is written with mode 0600, since it may hold a key.

## Finish

- SET-11: After a change, setup resolves the chain again, reports it as in
  SET-1 and SET-13, and asks the model that answers a one-line test question,
  printing the reply or the error. Then it shows the slots again.
- SET-12: EOF or ^C at any question leaves setup without writing anything not
  already saved, exit 0 when a model answers and 1 otherwise.

## Open

- Editing links past the second.
- Offering to install LM Studio or Ollama.
