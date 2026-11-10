# navi-raycast

The Raycast jack-in, specified in `spec.md` (RAY-1 to RAY-9). It is a front
end to navi's harness (`neonavi/harness`) and to setup's core
(`neonavi/setup`); it adds only Raycast's views.

**Navi Jobs** (`src/jobs.tsx`) is a window on navi serve's jobs: it talks to
the jobs API on `127.0.0.1:8484` with the token navi serve keeps
(`src/lib/jobs.ts`), and runs nothing itself (RAY-15 to RAY-17).

**Ask Navi**, **Navi Chat** and **Summarize** answer through the harness
(`src/lib/use-navi.ts`), working in `~/.navi-raycast` (created on first use),
so they get navi's prompt, tools, judge and limits. Each tool call shows as a
short line above the text and stays there (`src/lib/turn.ts` folds the events
into markdown). A shell command the judge did not pass pauses the answer and
shows the command with **Run Command** and **Don't Run**; Stop or leaving the
view declines (`src/lib/approval.ts`). Chats are the harness's history, kept in
Raycast's LocalStorage and continued with `harness.session(history)`
(`src/lib/chats.ts`); chats saved before the harness still open.

**Fix Spelling and Grammar** and **Translate and Replace** (no-view; the
_Translate To_ preference picks the language) call the model directly with no
tools and paste the cleaned reply over the selection. Prompts and reply
cleanup live in `src/lib/rewrite.ts`: the selection goes in a tagged block the
model is told to treat as data, and reasoning, wrapping quotes, fences and tags
are stripped before pasting.

**Set Up Navi** (`src/set-up-navi.tsx`) presents setup's core as views: the
primary and fallback slots and which one answers, then Providers (key in a
password field, checked by the core, then recommended models and All
Models…), Local (models by id, help, Check Again) and Custom (an Add Endpoint
form). After a change it asks the model a test question. Choices are saved to
`~/.neoai/config.json`, shared with the CLI; the extension has no model
preference. When no model answers, every command offers Set Up Navi first —
the views with a Set Up Navi action, the no-view commands by opening it.

Nothing shown names a product the user did not choose: a local model appears
by its id (`src/lib/labels.ts`), a provider only under Providers or once one
of its models is picked. The harness must not write to stdout or stderr here
(HAR-5), so `src/lib/quiet.ts` turns off neorouter's line and the AI SDK's
warnings before either is used.

Models think, as they do in navi (MOD-50): thinking the server sends apart
shows only as _Thinking…_ (RAY-21); any `<think>` output in the text is hidden
unless _Show the model's reasoning_ is on, and is never saved into history.

    cd jackins/raycast
    npm run dev     # load into Raycast with hot reload
    npm test        # node:test via tsx
    npm run lint

`ray lint` checks `author` in `package.json` against a real Raycast account.
