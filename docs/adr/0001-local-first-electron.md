# 0001 — Local-first Electron application, no server

- **Status:** Accepted (2026-10-24)
- **Supersedes:** the Next.js server architecture of the earlier prototype

## Context

The previous application was a Next.js app that stored the entire library as one JSON blob in
`localStorage` and proxied AI requests through its own server route. That produced three recurring
problems: the blob had to be written whole on every save, a crash or quota failure could lose the
whole library, and the app could not run without a browser tab and a server process. Authors also
asked, repeatedly, how their work would reach a second machine.

We are starting a new repository rather than carrying the earlier storage model forward.

## Decision

Ship a desktop application: Electron main process for files, Vite + React 19 renderer for the
interface, no HTTP server of our own.

- Files are written by the main process only.
- The renderer is sandboxed and reaches the main process through a typed `contextBridge` surface.
- The same React code is exercised in a browser build (`pnpm dev` in Vite alone is not supported yet,
  but the views never import Node APIs).
- AI requests will be made by the main process (see 0006), so no server route is needed for them.

## Consequences

Positive: the app opens without a network, the author's prose is in ordinary files, the attack
surface is small, and the renderer cannot corrupt the library. Packaging (dmg/nsis/AppImage) is a
single binary.

Negative: no browser deployment; Electron adds ~120 MB; we own the update channel and code signing;
smoke testing must drive a real Electron window.

Rejected alternatives: staying on Next.js + a local server (still a server); Tauri (smaller, but the
team's component library and AI SDK integration are React/Node-shaped and the Rust boundary would be
rewritten for every file operation); a browser-only PWA (no durable filesystem, no keychain, no
background writes).
