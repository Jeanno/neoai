# Models

Which model answers comes from `model` in `~/.neoai/config.json`, overridden by
`--model` for one run. Both take the same values.

## Spec values

- MOD-1: A spec is a string or list of strings. A string is split on commas.
  Whitespace is trimmed and empty parts dropped.
- ~~MOD-2: Unset or empty means `["remote", "local"]`.~~ Replaced by MOD-17.
- MOD-17: Unset or empty means `["local"]`: nothing leaves the machine until a
  provider or custom endpoint is chosen.
- MOD-3: Aliases: `local` and `fast` are the smallest usable local model;
  `best` is the largest local model that fits; `remote` is OpenRouter's free
  model with the largest context (MOD-9), kept for configs written before
  providers.
- MOD-4: `<provider>:<model>` names a model at a provider (MOD-14) or a custom
  endpoint (MOD-15), e.g. `anthropic:claude-sonnet-5-5`. `local:<id>` is
  always a local model, for local ids that contain `/` (LM Studio's
  `qwen/qwen3-4b`). A bare id containing `/` is `openrouter:<id>`; any other
  bare id is a local model.

## Providers

- MOD-14: The providers are OpenAI (`openai`), Anthropic (`anthropic`), Google
  Gemini (`google`), OpenRouter (`openrouter`), Groq (`groq`), DeepSeek
  (`deepseek`), Mistral (`mistral`) and xAI (`xai`), each reached through its
  OpenAI-compatible API. Adding one is one entry in a list in code.
- MOD-10: A provider's key is read from its usual environment variable first
  (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`,
  `XAI_API_KEY`), then `keys.<provider>` in the config file.
- MOD-15: A custom endpoint is any OpenAI-compatible server, saved as
  `custom.<name>: { "baseURL": "...", "key": "..." }` (the key is optional).
  A name may not be a provider id or `local`.
- MOD-16: Local discovery only probes the standard local servers (Ollama, LM
  Studio, llama.cpp, vLLM, Jan) and launchable runtimes. Anything else, such as
  a server on another machine, is a custom endpoint.

## Resolution

- MOD-5: The list is a fallback chain, tried in order. The first link that
  resolves is used for the whole run.
- MOD-6: Each link is scoped to what it names: a provider or custom link never
  falls to another provider or to a local model, and a local link never leaves
  the machine. There is no keyless tier.
- MOD-7: A provider or custom link fails when its key is missing, the server
  cannot be reached, or the model is not in the server's model list.
- MOD-19: A custom endpoint's pinned model that has left its model list is
  replaced by the endpoint's only model when it now lists exactly one (a
  server that switched models, such as a Darkbloom provider). The link then
  resolves, and which model was pinned and which answers is said wherever
  the answering model is shown. With several models listed, or at a
  provider, MOD-7 holds: the link fails.
- MOD-8: A local link fails when no server is reachable or launchable, or the
  pinned id is not installed.
- MOD-18: A local link can be probed without launching anything: it then
  looks only at servers already listening (rung 1 of neorouter), and fails
  when none has the model. Setup's first status uses this (SET-24); a run
  always may launch.
- MOD-9: The `remote` alias picks the free OpenRouter chat model with the
  largest context window from the live catalogue.
- ~~MOD-13: `free` is never in the default chain.~~ The keyless tier is gone.

## Context

- MOD-12: A hosted model's context window is read from the provider's model
  list when it says (OpenRouter does); 8192 is assumed otherwise.

## Reasoning

- MOD-11: navi asks local reasoning models and custom endpoints not to think
  (they exhaust the step budget otherwise, and are slow). A custom endpoint
  that rejects the request is asked again without it. Provider models are left
  as they are; reasoning is kept on.

## Open

- Per-link options such as reasoning effort or a token cap.
