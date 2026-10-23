# neoai

Run language models locally with no configuration.

- **[neorouter](neorouter/NAVI.md)** — an [AI SDK](https://ai-sdk.dev) provider that finds a model to talk to by
  itself: a server already running (Ollama, LM Studio, llama.cpp, vLLM, Jan) or a runtime it can launch, or the
  hosted provider you chose.
- **[neonavi](neonavi/NAVI.md)** — `navi`, a command-line agent built on top of it, with file-search and
  file-editing tools (every change shown as a diff), model-judged shell approval, images and PDFs
  as input, `navi serve`, which gives any app that takes an OpenAI base URL the same model, and
  `navi mcp`, which lets Claude Code or any MCP client hand navi a task.
- **[jack-ins](jackins/NAVI.md)** — navi jacked into the apps you already use, starting with
  [Raycast](jackins/raycast/NAVI.md).

## Install

You need Node 22+ and something for navi to talk to. Any one of these works:

- a local server, found by itself: [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), llama.cpp, vLLM or Jan
- a key for OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral or xAI, in its usual
  environment variable or added with `navi setup`
- any OpenAI-compatible server, such as one on another machine, added with `navi setup`

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

The installer ends by checking for a model. If it finds none, run `navi setup`. It shows your
primary and fallback models and lets you change either, from a provider (it asks for a key and
checks it), a model on your computer (with help getting LM Studio or Ollama going) or a custom
endpoint, and it tests the result. A saved key or endpoint can be removed there too. Until you
choose, nothing leaves your machine.

```bash
navi setup
navi -p "where is shell approval handled"
```

### navi in Raycast

Not a developer? Follow the [step-by-step guide](jackins/raycast/README.md) instead.

Needs [Raycast](https://raycast.com) 2.x on macOS. One line, no Node, npm or git:

```bash
curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/jackins/raycast/install.sh | sh
```

It downloads the latest prebuilt release into Raycast's extensions folder and registers it the way
`ray develop` does, so Raycast lists it as a development extension. Run it again to update. To
remove it, press ⌘K on a Navi command in Raycast → Uninstall Extension.

From a checkout instead:

```bash
cd jackins/raycast
npm run dev
```

Raycast picks up **Ask Navi** and **Navi Chat** as soon as the build says `ready`. Press ⌃C when
you're done: the extension stays installed. Run `npm run dev` again after pulling changes.

Releases: push a `raycast-v<version>` tag and CI (`.github/workflows/raycast-release.yml`) tests,
builds with `jackins/raycast/scripts/dist.sh` and attaches `navi-raycast.tar.gz` to a GitHub release.

The model that answered is shown in each view. To change it, run **Set Up Navi** in Raycast or
`navi setup` in a terminal: both save to `~/.neoai/config.json`, so the CLI and Raycast always agree.

### Development

```bash
npm test            # every package
npm run typecheck
```

Configuration lives in `~/.neoai/config.json` (see [`config.example.json`](config.example.json)); conversation
history sits beside it in `~/.neoai/sessions/`. More detail in [NAVI.md](NAVI.md).

## License

[MIT](LICENSE)
