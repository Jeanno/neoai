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
- MOD-20: A custom endpoint whose address is this computer's own (loopback,
  `localhost`, or an address of one of its network interfaces, such as its
  Tailscale address) keeps prompts on this computer and is described as
  local. It is still named by its endpoint name, and still waited on and
  retried like a hosted server, since it is often a busy shared one.

## Resolution

- MOD-5: The list is a fallback chain, tried in order. The first link that
  resolves is used for the whole run, unless it fails at runtime (MOD-40).
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
- MOD-21: A failed link says why, in words naming it: no key for the
  provider, no endpoint by that name, the server not reached (with its
  address), the key refused, the model not served (with what is, when the
  list is short), the model not installed, or no local server running or
  installed. `navi` prints each failed link's reason when no link answers,
  and on stderr when a later link answers instead; setup reports them
  (SET-1) and Raycast shows them where it says no model answers (RAY-7).
- MOD-22: A resolution is remembered for the life of the process, but a
  failed link only for 30 seconds: a long-running navi (`serve`, `mcp`, an
  interactive session) looks again once the user has started the server or
  saved the key it lacked.
- MOD-23: What is remembered (MOD-22) holds only while the config file
  (`~/.neoai/config.json`, where links' endpoints and keys are kept) is as
  it was: once it changes, the next resolution looks afresh, so a
  long-running navi follows a new endpoint, key or model without a restart.
- MOD-8: A local link fails when no server is reachable or launchable, or the
  pinned id is not installed.
- MOD-18: A local link can be probed without launching anything: it then
  looks only at servers already listening (rung 1 of neorouter), and fails
  when none has the model. Setup's first status uses this (SET-24); a run
  always may launch.
- MOD-9: The `remote` alias picks the free OpenRouter chat model with the
  largest context window from the live catalogue.
- ~~MOD-13: `free` is never in the default chain.~~ The keyless tier is gone.

## When a link fails at runtime

- MOD-40: When the link answering a request fails, after neorouter's own
  retries (MOD-42), for anything but the request's own fault (MOD-41) and
  not because the caller stopped it, that request goes to the next link of
  the chain that resolves, and on down it. This is not escalation (ESC-*):
  the turn did not struggle, its model was away. Links before the one the
  session started on (MOD-5) are not tried, and a step whose answer has
  begun is not moved. For the rest of that turn its steps go straight to
  the link that answered. The next turn tries the model again, once and
  without retries, so a model still down costs no second wait through the
  backoff: failing again, it hands over at once; answering, it is trusted
  again, retries and all. `navi`, `navi -p`, a job and `navi mcp` all do
  this; `navi serve` does it per request (SRV-4).
- MOD-41: A failed call is one of: not reached (no connection, or no
  answer in time), the key refused (401, 403), out of credit (402), the
  model gone (404, or the server saying the model is not found), busy or
  at capacity (429, 503, 529, or the server saying capacity, queue full,
  overloaded or rate limit), not loaded (the server saying the model is not
  loaded or still loading), a server error (another 5xx), or the request
  refused (any other 4xx, such as a context too long or a tool schema the
  server rejects). A refused request is not passed on: a backup would be
  sent the same request. Each carries the status and the server's own
  words, short and without the address.
- MOD-42: neorouter tries a call to a hosted or custom server again three
  times, 1.5, 3 and 6 seconds apart, on no connection or a 402, 408, 409,
  425, 429, 5xx or 529; a caller can ask for fewer for one call
  (`providerOptions.neorouter.retries`).
- MOD-43: A link that fails at runtime is said in words naming it by its
  slot (MOD-44) and model, and why (MOD-41): "the model, qwen3 on
  Darkbloom, is busy or at capacity (429 capacity (queueFull))". When no
  link answers, the turn's error lists each link tried that way, in every
  front end; setup's test question words its failure the same way (SET-34).
- MOD-44: Links are named by slot in everything navi says: "the model",
  "the backup", then "link 3" and on (SET-30), never "primary" or
  "fallback": in `navi`'s failures (MOD-21), setup, and `navi serve`'s log
  and errors.

## Context

- MOD-12: A hosted model's context window is read from the provider's model
  list when it says (OpenRouter does); 8192 is assumed otherwise.

## Reasoning

- ~~MOD-11: navi asks local reasoning models and custom endpoints not to think
  (they exhaust the step budget otherwise, and are slow). A custom endpoint
  that rejects the request is asked again without it. Provider models are left
  as they are; reasoning is kept on.~~ Replaced by MOD-50: thinking is worth
  its wait (Qwen3.8-27B scores ~49% on Terminal-Bench 2.1 without it, ~80%
  with it).
- MOD-50: Every model thinks by default: local, custom endpoint and
  provider alike, as its server would when not told otherwise. navi sends
  nothing to turn thinking off unless `think` is false in the link's options
  (MOD-24) or a call asks (MOD-53). Then a local server (Ollama) or custom
  endpoint is sent `reasoning_effort: "none"`, and Anthropic
  `thinking: {type: "between_tools"}` (its compatibility API ignores
  `reasoning_effort`); other providers are sent nothing. A server that
  refuses that field with a 400 naming it is asked again without it, so a
  model that cannot stop thinking (Claude Opus 5.5) still answers.
- MOD-51: While a model thinks, the user sees that it is thinking, never what
  it thinks: the CLI's spinner says "thinking…" beside its frame (dim, on a
  terminal only) from the first thinking of each step until text or a tool
  call; Raycast shows _Thinking…_ (RAY-21). The harness says so with one
  `thinking` event per step that thinks (HAR-17). A model whose server keeps
  its thinking to itself (Anthropic's) shows the plain spinner.
- MOD-52: Thinking a server sends apart from the answer
  (`reasoning_content`, or `reasoning`, streamed or whole) is passed on as
  reasoning, never as text, as MOD-26 does for thinking written into the
  text. It is not kept in the conversation: it is never sent back, and kept
  it would fill the window and bring compaction on early (SES-8). An answer
  that was only thinking is dropped from it.
- MOD-53: A call that wants a quick answer more than a considered one asks
  for thinking off, over the link's own `think`: the judge (TL-49) and a
  picture's description (BRW-18), which would otherwise also spend its
  1500-token cap thinking. Measured on Qwen3.8-27B on Darkbloom: a verdict
  in ~0.8s rather than 2.7–5.5s; on Claude Sonnet 5.5 the verdicts on the
  TL-46 cases were the same either way.
- MOD-54: Thinking counts as output: servers count it in an answer's output
  tokens, so `maxTokens` and `tokenCap` (MOD-24, MOD-27) hold thinking and
  answer together, and a low cap is reached sooner; a turn whose thinking
  spent the whole cap is cut (HAR-16). The ledger's token counts (LED-18), and
  `navi usage`'s cost from them, include thinking as the server counted it.
- MOD-55: Asked as a turn asks, the setup test question (SET-11) thinks too
  (SET-35), so it shows what the model will do in use.

## Options per link

- MOD-24: `"modelOptions"` in the config gives a link options, keyed by the
  link as the chain would name it (`"Darkbloom:qwen3.6"`, `"local"`, …; keys
  naming the same model are one, so `"local"` is `"fast"`): `maxTokens`, at
  most that many tokens in each answer; `temperature`, from 0 to 2; and
  `think`, false to ask a reasoning model not to think (MOD-50; true, the
  default, leaves it to think). They apply wherever navi uses that link: a turn, a job, an escalation,
  Raycast. What a caller asks for itself still wins.
- MOD-25: A value that is not one of these, or out of range, is left out;
  the chain itself (`"model"`) is unchanged, so setup and older readers are
  unaffected.

- MOD-26: Thinking a model writes into its answer is taken out of the text
  and passed on as reasoning, for every model navi makes from the chain or
  the escalation spec: a leading `<think>…</think>`, or a bare `</think>` at
  the start (a server whose chat template opened the tag in the prompt).
  Streamed, the start of each step's text is held only while it could still
  be such a tag; a whole answer (the judge's, the summariser's) also loses
  thinking that comes before a bare `</think>`. A tag later in an answer is
  left as written. Blank lines before an answer are dropped too.
- MOD-27: `tokenCap`, a whole number above 0, is a cap no caller gets past:
  every answer from that link is asked for at most that many tokens,
  whether navi, Raycast, a job or an app through `navi serve` (SRV-10)
  asked for more, for less, or for nothing. Unlike `maxTokens` it is not a
  default but a ceiling; with both, `maxTokens` is the size asked when the
  caller names none, and is itself held to the cap.

## Open
- MOD-28: With `NEOROUTER_SEEN` naming a file, the announcement (CLI-15)
  is made only when it differs from the last one written there, and is then
  written there: a caller that asks many times, as a shell does, hears which
  backend answered when it changes (the model, the rung, REMOTE, a cold
  start), not every time. An unreadable or unwritable file announces as
  without one. `NEOROUTER_QUIET` still says nothing at all.
