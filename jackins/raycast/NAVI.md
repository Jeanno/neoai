# navi-raycast

The Raycast jack-in: **Ask Navi** for a one-off answer, **Navi Chat** for a
conversation kept in Raycast's local storage. There is no URL, key or model to
set — the model comes from the same chain `navi` walks (`model` in
`~/.neoai/config.json`, or the extension's optional Model preference, which
takes the same values as `--model`). The backend that answered is shown in the
view, with *(remote)* when prompts leave the machine.

It is chat only: no tools, no shell, no per-directory sessions. Reasoning
models are asked not to think, as navi does; any `<think>` output that still
arrives is hidden unless *Show the model's reasoning* is on, and is never saved
into history.

    cd jackins/raycast
    npm run dev     # load into Raycast with hot reload
    npm test        # node:test via tsx
    npm run lint

`ray lint` checks `author` in `package.json` against a real Raycast account.
