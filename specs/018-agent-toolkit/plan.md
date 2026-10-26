# Plan: agent toolkit

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Shape

```
apps/desktop/src/main/backend.ts       loopback HTTP control plane over the open Studio
apps/toolkit/src/backend-client.ts     locator discovery, bearer fetch, typed errors
apps/toolkit/src/mcp.ts                JSON-RPC stdio server, tool table, write gate
apps/toolkit/src/cli.ts                command parsing, human and --json output
apps/toolkit/package.json              bookwriter bin, workspace dependency on core
```

The desktop remains the only process that opens a library and the only process that reads a provider
key. The toolkit is a thin client with no Electron and no `node:fs` library access.

## Backend

`LocalBackend` starts after `Studio.restore()` in the normal app and stops in the existing
`before-quit` chain. It binds `127.0.0.1:0`, generates 32 random bytes, writes
`~/.ai-book-studio/backend.json` with mode `0600`, and removes that file only when its token still
matches. Headless/test runs do not start it.

Every route calls `studio.requireLibrary()` and the existing methods. The save route forwards the
author's `baseVersion` and `baseHash`; it never calls a lower-level writer. The response envelope is
JSON, with no CORS and no static files.

## Toolkit

`backend-client.ts` resolves configuration in this order: CLI flags, environment, locator file. A
missing locator or a refused connection becomes `Start AI Book Studio and open a library first.` The
client validates the locator version and URL scheme (loopback HTTP only).

`mcp.ts` is transport-only: it reads one JSON-RPC message per line from stdin and writes one per line
to stdout. Diagnostics go to stderr. Tools are defined as a table with a Zod-like manual argument check
(no extra dependency) and each result is serialized JSON text. `--allow-writes` adds `create_chapter`
and `save_chapter`; it never defaults on.

`cli.ts` has a small parser, no commander dependency. It prints tables for humans and raw JSON with
`--json`. `save` and `create-chapter` read content from a file or stdin, never from an inline shell
argument that would land in history.

## Packaging

`apps/toolkit/package.json` declares `bin: { "bookwriter": "./src/cli.ts" }` and a `build` script that
compiles `src/cli.ts` with Bun to `dist/bookwriter`. Local install:

```bash
cd apps/toolkit
bun link
bookwriter mcp
```

The compiled binary is the standalone artefact; it still connects to the desktop backend.

## Verification

- Backend tests start on port 0 with a fake library and a temporary locator: auth, origin, host,
  routes, checked save, body limit.
- Toolkit tests exercise locator resolution, the CLI parser and the MCP initialize/tools/list/call
  flow with a fake client.
- End-to-end manual pass: open the studio, run `bookwriter books`, read a chapter, save with the
  returned version/hash, connect an MCP client.
- `bun run typecheck`, `bun test`, `bun run build`, `bun run toolkit:build`.
