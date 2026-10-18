# neoai

Run language models locally with no configuration.

- **[neorouter](neorouter/NAVI.md)** — an [AI SDK](https://ai-sdk.dev) provider that finds a model to talk to by
  itself: a server already running (Ollama, LM Studio, llama.cpp, vLLM, Jan), a runtime it can launch, or a hosted
  fallback. You never name a model, a URL, or a key.
- **[neonavi](neonavi/NAVI.md)** — `navi`, a command-line agent built on top of it, with file-search tools and
  model-judged shell approval.

```bash
npm install
npm test
npx tsx neonavi/src/cli.ts -p "where is shell approval handled"
```

Configuration lives in `~/.neoai/config.json` (see [`config.example.json`](config.example.json)); conversation
history sits beside it in `~/.neoai/sessions/`. More detail in [NAVI.md](NAVI.md).

## License

[MIT](LICENSE)
