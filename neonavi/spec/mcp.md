# MCP

`navi mcp`: navi as a Model Context Protocol server over stdio, so an MCP
client (Claude Desktop, Claude Code, Cursor, …) can hand a task to navi and
its model.

- MCP-1: `navi mcp` speaks JSON-RPC 2.0 over stdin and stdout, one message
  per line, and answers `initialize` (echoing the client's protocol version),
  `ping`, `tools/list` and `tools/call`. Notifications get no reply; an
  unknown method is error -32601. stdout carries protocol messages only;
  anything else goes to stderr.
- MCP-2: It offers one tool, `ask_navi`, taking `prompt`, and optionally
  `directory` (absolute; the server's own working directory otherwise) and
  `files` (paths to attach, HAR-7). One call is one harness turn (HAR-2) in
  that directory with a fresh history, answered by the configured chain
  (MOD-5).
- MCP-3: The result is the turn's answer as text, followed by a line naming
  the model that answered. A turn that fails, or a model chain where nothing
  answers (with each link's reason, MOD-21), is a tool result with `isError`,
  never a protocol error.
- MCP-4: Nothing can be asked of the user over MCP, so whatever would need a
  `y` is declined: a shell command not judged safe (TL-13) and a file change
  other than a new file in the directory (TL-38). The model is told, as with
  any decline, not to retry.
- MCP-5: Calls may overlap; each runs on its own.
- MCP-6: `navi mcp --browser` also offers navi's browser tools themselves
  (`browser.md`), under the same names and inputs, for the client's own
  model to drive navi's browser, where the user is signed in. They are
  offered only when asked for this way. The server holds one session's
  tabs for every call. Opening, reading, listing, switching, going back and
  looking are marked `readOnlyHint`; acting, uploading and closing a tab
  are marked `destructiveHint`, so the client's own approval asks: the
  client's yes is the approval, and navi's judge and asking (BRW-11) are not
  used, though an action is still not done on a page that changed since it
  was described. Uploads are taken from, and downloads kept in, the
  server's working directory.
- MCP-7: Over MCP, `browser_look` answers with the picture itself, as MCP
  image content beside the page's URL, for the client's model to see.
