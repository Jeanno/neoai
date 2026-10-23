# neoai

A monorepo for running language models locally with no configuration.

- **neorouter** — an AI SDK provider that finds a model to talk to by itself.
- **neonavi** — `navi`, a command-line agent built on top of it.
- **jackins/** — where navi meets a host app; one package per host.
  `jackins/raycast` (navi-raycast) is the first.

## Direction

neoai is its author's daily driver first; adoption polish (npm, docs for
strangers) waits. Work goes to three tracks, in this order:

1. **Dependable**: "no configuration" holds when things change underneath:
   a pinned model goes away, a server moves, a key expires. When navi
   can't answer, it says exactly why.
2. **Daily driver**: navi is the agent reached for first: it edits files,
   takes images and PDFs, and switches models mid-session.
3. **Everywhere**: navi's model chain reaches other apps through one
   OpenAI-compatible local endpoint and an MCP server, not one jack-in per app.

The ordered list is `neonavi/TODO.md`.

## Layout

Configuration lives in `~/.neoai/config.json`; `config.example.json` here shows
the shape. Conversation history sits beside it in `~/.neoai/sessions/`.

TypeScript, ESM, npm workspaces. Tests are `node:test` via `tsx`; `npm test`
and `npm run typecheck` run across all packages.
