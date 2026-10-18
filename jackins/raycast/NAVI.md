# navi-raycast

The Raycast jack-in: **Ask Navi** for a one-off answer, **Navi Chat** for a
conversation kept in Raycast's local storage. There is no URL, key or model to
set — the model comes from the same chain `navi` walks (`model` in
`~/.neoai/config.json`, or the extension's optional Model preference, which
takes the same values as `--model`). The backend that answered is shown in the
view, with _(remote)_ when prompts leave the machine.

Three commands work on selected text, using `getSelectedText()`:
**Fix Spelling and Grammar** and **Translate and Replace** (no-view; the
_Translate To_ preference picks the language) call `generateText` and paste the
cleaned reply over the selection; **Summarize** streams into a Detail view and
falls back to the clipboard when nothing is selected. Prompts and reply cleanup
live in `src/lib/rewrite.ts`: the selection goes in a tagged block the model is
told to treat as data, and reasoning, wrapping quotes, fences and tags are
stripped before pasting.

It is chat only: no tools, no shell, no per-directory sessions. Reasoning
models are asked not to think, as navi does; any `<think>` output that still
arrives is hidden unless _Show the model's reasoning_ is on, and is never saved
into history.

    cd jackins/raycast
    npm run dev     # load into Raycast with hot reload
    npm test        # node:test via tsx
    npm run lint

`ray lint` checks `author` in `package.json` against a real Raycast account.
