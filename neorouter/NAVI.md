# neorouter

`auto()` returns an AI SDK LanguageModelV2 that resolves a backend on first use,
so the caller never names a model, a URL, or a key.

Resolution goes down three rungs, in order:

1. **reachable** — a server already listening (ollama, LM Studio, llama.cpp, vLLM, Jan)
2. **launched** — a runtime installed but idle, which it starts itself
3. **hosted** — a keyless endpoint, used only when there is nothing local

It then ranks the models that backend offers and picks the largest that fits the
machine's memory, or the smallest usable one with `auto({ prefer: 'fast' })`.
`auto({ think: false })` asks a reasoning model to skip thinking.

Above the keyless tier sits OpenRouter, present only when a key is:
`OPENROUTER_API_KEY`, or in `~/.neoai/config.json`

    { "keys": { "openrouter": "sk-or-..." } }

with the environment taking precedence. It picks the roomiest free chat model
from the live catalogue.

Which backend answered is announced once on stderr, so a local-looking call that
quietly went to the network cannot pass unnoticed.

Tool calling works on the non-streaming path only; `doStream` still warns.
