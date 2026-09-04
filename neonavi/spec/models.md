# Models

Which model answers comes from `model` in `~/.neoai/config.json`, overridden by
`--model` for one run. Both take the same values.

## Spec values

- MOD-1: A spec is a string or list of strings. A string is split on commas.
  Whitespace is trimmed and empty parts dropped.
- MOD-2: Unset or empty means `["remote", "local"]`.
- MOD-3: Aliases: `remote` is the keyed hosted tier; `local` and `fast` are the
  smallest usable local model; `best` is the largest local model that fits.
- MOD-4: Any other value is an exact model id. An id containing `/` is a hosted
  (OpenRouter) model; anything else is a local one.

## Resolution

- MOD-5: The list is a fallback chain, tried in order. The first link that
  resolves is used for the whole run.
- MOD-6: Each link is scoped to the tier it names: a remote link never falls to
  a local model or the keyless tier, and a local link never goes remote.
- MOD-7: A remote link fails when there is no OpenRouter key, no network, or
  the pinned id is not in the OpenRouter catalogue.
- MOD-8: A local link fails when no server is reachable or launchable, or the
  pinned id is not installed.
- MOD-9: The `remote` alias picks the free OpenRouter chat model with the
  largest context window from the live catalogue.
- MOD-10: The OpenRouter key is read from `OPENROUTER_API_KEY` first, then
  `keys.openrouter` in the config file.

## Reasoning

- MOD-11: navi asks local reasoning models not to think (they exhaust the step
  budget otherwise). Hosted models are left as they are; reasoning is kept on.

## Open

- The hosted rung reports an 8k context window regardless of the model.
- Per-link options such as reasoning effort or a token cap.
