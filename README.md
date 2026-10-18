# neoai

Run language models locally with no configuration.

- **[neorouter](neorouter/NAVI.md)** — an [AI SDK](https://ai-sdk.dev) provider that finds a model to talk to by
  itself: a server already running (Ollama, LM Studio, llama.cpp, vLLM, Jan), a runtime it can launch, or a hosted
  fallback. You never name a model, a URL, or a key.
- **[neonavi](neonavi/NAVI.md)** — `navi`, a command-line agent built on top of it, with file-search tools and
  model-judged shell approval.
- **[jack-ins](jackins/NAVI.md)** — navi jacked into the apps you already use, starting with
  [Raycast](jackins/raycast/NAVI.md).

## Install

You need Node 22+ and something for navi to talk to. Any one of these works,
and none needs configuring:

- a local server: [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), llama.cpp, vLLM or Jan
- [Darkbloom](https://darkbloom.dev) in local mode (`darkbloom start --local`)
- an [OpenRouter](https://openrouter.ai) key in `OPENROUTER_API_KEY` or `~/.neoai/config.json`

```bash
git clone https://github.com/Jeanno/neoai.git
cd neoai
npm install
```

### navi in the terminal

One line, no checkout needed (Node 22+ and git):

```bash
curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/neonavi/install.sh | sh
```

From a checkout, `./neonavi/install.sh` does the same with the code you have. Either way you get a
`navi` command in `~/.local/bin`; run the installer again to update, or pass `--uninstall` to remove it
(`… | sh -s -- --uninstall`).

```bash
navi -p "where is shell approval handled"
```

### navi in Raycast

Not a developer? Follow the [step-by-step guide](jackins/raycast/README.md) instead.

Needs [Raycast](https://raycast.com) 2.x.

```bash
cd jackins/raycast
npm run dev
```

Raycast picks up **Ask Navi** and **Navi Chat** as soon as the build says `ready`. Press ⌃C when
you're done: the extension stays installed. Run `npm run dev` again after pulling changes.

The backend that answered is shown in each view. To pin one, set **Model** in the extension's
preferences (⌘K → Configure Extension) — the same values as `navi --model`.

### Development

```bash
npm test            # every package
npm run typecheck
```

Configuration lives in `~/.neoai/config.json` (see [`config.example.json`](config.example.json)); conversation
history sits beside it in `~/.neoai/sessions/`. More detail in [NAVI.md](NAVI.md).

## License

[MIT](LICENSE)
