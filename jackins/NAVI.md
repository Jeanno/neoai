# jack-ins

Three layers, each built on the one below:

| Layer | Package | Job |
|---|---|---|
| Model | `neorouter` | find a model and talk to it |
| Harness | `neonavi` | the agent: prompt, tools, sessions, approval |
| Jack-in | `jackins/*` | put navi where you already are |

A jack-in is a thin package that plugs navi into one host app — a launcher,
an editor, a chat app, a protocol. It owns the host's UI and conventions and
nothing else: which model answers comes from navi's chain, never from a
jack-in's own settings.

One directory per host, one package each, named `navi-<host>` so people can
find it:

| Jack-in | Package | Status |
|---|---|---|
| [`raycast/`](raycast/NAVI.md) | `navi-raycast` | Ask Navi, Navi Chat, Set Up Navi |

## Open

- Candidates: an MCP server and an OpenAI-compatible HTTP server (each opens
  navi to many apps at once), VS Code, Shortcuts, git hooks, chat bots.
