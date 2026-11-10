# neorouter

`auto()` returns an AI SDK LanguageModelV2 that resolves a backend on first use,
so the caller never names a model, a URL, or a key.

Resolution goes down three rungs, in order:

1. **reachable** — a server already listening on a standard local port (ollama, LM Studio,
   llama.cpp, vLLM, Jan)
2. **launched** — a runtime installed but idle, which it starts itself
3. **hosted** — OpenRouter when a key is present, then a keyless endpoint, used only when
   there is nothing local and nothing narrower was asked for

It then ranks the models that backend offers and picks the largest that fits the
machine's memory, or the smallest usable one with `auto({ prefer: 'fast' })`.
`auto({ think: false })` asks a reasoning model to skip thinking.

`auto({ provider, model })` skips the rungs and talks to one hosted provider or
custom endpoint, failing rather than falling anywhere else. The providers
(OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI) are
one list in `src/providers.ts`, each through its OpenAI-compatible API. A key is
read from the provider's usual variable (`ANTHROPIC_API_KEY`, …) first, then
`~/.neoai/config.json`; a custom endpoint is any OpenAI-compatible server,
including one on another machine:

    {
      "keys": { "anthropic": "sk-ant-..." },
      "custom": { "homelab": { "baseURL": "http://my-server:8000/v1", "key": "..." } }
    }

What a process has resolved is remembered, but only while this file stays as
it was: edit a key or an endpoint and a long-running process picks it up at its
next request, with no restart.

A pinned model must be in the server's live model list. Without one, only
OpenRouter has a pick: the roomiest free chat model in its catalogue.
`checkKey` and `fetchModels` tell a refused key from no network, for setup.

A call to a hosted or custom server is tried again three times (1.5, 3, 6 s) on
no connection, 402, 408, 409, 425, 429, 5xx or 529; `providerOptions.neorouter.retries`
asks for fewer. A call that still fails throws a `CallError` whose `trouble` says what
kind (`unreachable`, `key`, `gone`, `busy`, `loading`, `credit`, `server`, `request`)
and whose `detail` is the status and the server's own words, without the URL, so a
caller can move on to another model and say why (navi's MOD-40, MOD-41).

Which backend answered is announced once on stderr, so a local-looking call that
quietly went to the network cannot pass unnoticed.

Tool calling works on the non-streaming path only; `doStream` still warns.
