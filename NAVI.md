# neoai

A monorepo for running language models locally with no configuration.

- **neorouter** — an AI SDK provider that finds a model to talk to by itself.
- **neonavi** — `navi`, a command-line agent built on top of it.

Configuration lives in `~/.neoai/config.json`; `config.example.json` here shows
the shape. Conversation history sits beside it in `~/.neoai/sessions/`.

TypeScript, ESM, npm workspaces. Tests are `node:test` via `tsx`; `npm test`
and `npm run typecheck` run across both packages.
