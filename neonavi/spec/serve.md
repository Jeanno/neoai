# Serve

`navi serve`: navi's model chain as an OpenAI-compatible server on this
computer, so any app that takes a base URL answers with the same model, and
falls back the same way.

- SRV-1: `navi serve [--port N]` listens on 127.0.0.1 only, port 8484 unless
  told otherwise, and prints the base URL to give apps
  (`http://127.0.0.1:8484/v1`) and which model answers now (SET-1). It runs
  until stopped (^C).
- SRV-2: `GET /v1/models` lists one model, `navi`. Apps that insist on
  picking a model from the list pick that.
- SRV-3: `POST /v1/chat/completions` is answered by the chain (MOD-5),
  whatever model the request names: the body is passed through as sent
  (messages, images, tools, streaming, sampling) with `model` replaced by the
  resolved model's id, plus what navi would add itself for that backend
  (MOD-11's `reasoning_effort`) when the request does not set it. The
  response, streamed or not, is passed back as the backend sends it.
- SRV-4: When a link cannot be reached, or answers 429 or 5xx, before any of
  its response has been passed back, the request goes to the next link that
  resolves. When none answers, the reply is a 503 in OpenAI's error shape
  listing each link with why (MOD-21).
- SRV-5: A request carrying an `Origin` header is refused with 403: a web
  page in a browser must not reach the user's keys through this server.
  Apps on the computer send none.
- SRV-6: Every request is logged on stderr in one line: the path, which link
  answered, the status and how long it took. Prompts and keys are never
  logged.
- SRV-7: Any other path is a 404 in OpenAI's error shape.
- SRV-8: On macOS, `navi serve --install [--port N]` keeps it running: a
  LaunchAgent (`dev.neoai.navi-serve`) starts it now and at every login and
  restarts it if it stops, logging to `~/Library/Logs/navi-serve.log`. It
  runs the `navi` found on PATH, so updating navi updates it once restarted;
  installing again replaces it. A provider key only exported in the shell is not seen
  by launchd, so installing names any such key and says to save it with
  `navi setup`; when launchd will not start it, the reason is printed and
  nothing is left installed. `navi serve --uninstall` stops and removes
  it, and says when there was nothing to remove.
