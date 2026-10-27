# 0006 — AI calls and secrets belong to the main process

- **Status:** Accepted, implementation in spec 003

## Context

An earlier studio asked for an OpenRouter key and kept it in `localStorage`, then sent it from the
browser to its own server route so the server could forward it. Two problems: any script on the page
could read the key, and the product needed a server to exist. In an Electron app, a renderer that can
call an API directly is also a renderer that can be talked into exfiltrating a key by a compromised
dependency.

## Decision

- The OpenRouter key is entered in the interface but stored by the main process in the OS keychain
  (`safeStorage` on macOS/Windows; a file with `0600` permissions where no keychain exists).
- The renderer can ask "is a key set?", "test this key" and "forget the key". It never receives the
  key back.
- Model calls are made from the main process with the Vercel AI SDK + OpenRouter provider, streamed to
  the renderer as typed IPC events (text delta, reasoning delta, tool call, tool result, usage,
  finish). Cancellation is an IPC message that aborts the request.
- Tool calls that edit the manuscript go through the same `Library` methods the editor uses: version
  and hash checks, atomic writes, limits, conflict copies, checkpoints.
- No telemetry, no prompt logging to disk beyond the conversation the author can see and delete.

## Consequences

Positive: the key never enters renderer memory; no CORS or proxy server; the agent's writes are
auditable and reversible; conversations can be stored per book in the library rather than in browser
storage.

Negative: streaming plumbing is ours to build (no `useChat` over HTTP); the main process needs the
provider SDK and must stay responsive (async, abortable); Linux keychain support is uneven, so a
fallback with clear warnings is required; shipping `ai` in the main bundle increases its size.

Rejected alternatives: key in `localStorage` (previous design, trivially exfiltrated); key in an
`.env` file (does not work for end users); a hosted proxy (custody and cost); renderer-side calls
(key exposure, CSP loosening, no filesystem tools).
