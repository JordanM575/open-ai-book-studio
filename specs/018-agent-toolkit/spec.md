# Agent toolkit: CLI, MCP and the local backend

**Status:** Planned (2026-10-26)
**Number:** 018
**Depends on:** [002](../002-studio-v1/spec.md) library and format, [013](../013-builds-and-deployment/spec.md)
desktop packaging, [017](../017-voice-and-background/spec.md) background process lifecycle.

## Why

The studio should not be the only client of its own library. Authors and their agents use terminals,
editors and MCP clients. A standalone `bookwriter` toolkit lets another agent list books, read a
chapter, search, and make a checked write against the same files the studio has open — without a
second copy of the library, a hosted account or a new sync service.

The toolkit is a client. The desktop application remains the owner of the open library and the only
process that holds a provider key. The connection is a loopback-only HTTP backend with a per-run
token, discovered from an owner-only file.

## User stories

1. **Inspect from a terminal.** `bookwriter books` lists the open library; `bookwriter read <book>
   <chapter>` prints the Markdown. The studio does not need to be in focus.
2. **Let an MCP client write.** Claude Desktop, Cursor or a local agent connects to `bookwriter mcp`
   over stdio, discovers the tools and reads a chapter. A write succeeds only when the client supplies
   the version and hash it read; a stale write becomes the studio's normal conflict copy.
3. **Keep writes deliberate.** The MCP server exposes read tools by default. Write tools require
   `--allow-writes`; the CLI's `save` command requires the expected version and hash.
4. **No hidden server.** The backend listens on `127.0.0.1` with a random port and a 256-bit token,
   rejects browser origins and writes the token to a `0600` file. There is no LAN listener, account,
   telemetry or hosted copy.
5. **Know when the studio is closed.** A missing locator or a refused connection produces one sentence
   that says to open the desktop app. The CLI never starts its own library copy.

## Requirements

### Backend

- **FR-001** The desktop main process MUST start a loopback HTTP backend when the normal app launches
  and stop it before quit. It MUST NOT start in headless test runs or write the production locator in
  a test profile.
- **FR-002** The listener MUST bind `127.0.0.1` on a random port. A request with a browser `Origin`
  header, a non-loopback `Host`, or a missing/incorrect `Authorization: Bearer` token MUST be refused.
- **FR-003** The token MUST be at least 256 bits from a cryptographic source, compared in constant
  time, written with mode `0600` and removed on quit. The locator file MUST contain only the URL,
  token, pid, start time and library root; never prose or a provider key.
- **FR-004** The backend MUST use the open `Studio`/`Library` service. It MUST NOT open a second
  library, copy files, or add a second save path.
- **FR-005** Routes: health, library info, list books, read book, read chapter, search, list conflicts,
  create chapter, save chapter. A save MUST require `content`, `baseVersion` and a 64-character
  `baseHash`; the existing conflict result is returned unchanged.
- **FR-006** Bodies MUST be capped at 20 MB of prose plus framing. IDs MUST be validated with the
  shared schema. Errors MUST use a small JSON envelope and a truthful status: 400 invalid, 401 auth,
  403 origin/host, 404 unknown, 409 no library or conflict, 413 too large, 500 internal.
- **FR-007** The backend MUST NOT add CORS headers, accept form uploads, serve static files or proxy a
  model provider.

### CLI and MCP

- **FR-008** `bookwriter` MUST be installable as a workspace binary (`bun link` or a compiled binary)
  with `info`, `books`, `read`, `search`, `conflicts`, `create-chapter`, `save` and `mcp` commands.
- **FR-009** Discovery order: `--url`/`--token`, then `BOOKWRITER_URL`/`BOOKWRITER_TOKEN`, then the
  locator file at `~/.ai-book-studio/backend.json` (or `STUDIO_BACKEND_FILE`). A missing locator is an
  actionable error, not a crash.
- **FR-010** `bookwriter mcp` MUST speak the Model Context Protocol over stdio using newline-delimited
  JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
  Invalid JSON, unknown methods and tool failures MUST return JSON-RPC errors or `isError` content,
  never a stack trace on stdout.
- **FR-011** Read tools: `library_info`, `list_books`, `read_book`, `read_chapter`, `search_book`,
  `list_conflicts`. Write tools `create_chapter` and `save_chapter` MUST be absent unless the server
  starts with `--allow-writes`.
- **FR-012** Tool results MUST be JSON text content so any MCP client can read them. The server MUST NOT
  include the token, provider key or an absolute host path in a tool result where a library-relative
  value is enough.
- **FR-013** The CLI MUST write normal output to stdout and diagnostics to stderr. `--json` returns the
  exact backend payload. A refused backend exits non-zero with one sentence.
- **FR-014** The toolkit MUST NOT call a model provider, hold a credential, start the studio or write
  outside the library through the backend.

## Non-goals

- Remote or LAN access, a tunnel, a hosted MCP endpoint, accounts, OAuth or multi-user permissions.
- Model inference through the toolkit. It operates on the library; the studio's agent remains in the
  desktop app.
- A second sync, watch or conflict mechanism. The existing library service is the only writer.
- A GUI. The CLI and MCP server are the product.
- Windows service installation or a background daemon outside the desktop app.

## Acceptance scenarios

1. **Read.** With the studio open, `bookwriter books` lists the library and `bookwriter read <book>
   <chapter>` prints the chapter. With the studio closed, the command exits non-zero and names the app.
2. **Checked write.** Read a chapter, edit it, save with the returned version and hash. The file changes
   once; a second save with the old values returns a conflict result and preserves both versions.
3. **MCP discovery.** An MCP client initializes, lists tools and reads a chapter. `save_chapter` is
   absent without `--allow-writes` and present with it.
4. **Token refusal.** A request without the token, with the wrong token, with an `Origin` header or
   with a non-loopback `Host` gets 401/403 and no library data.
5. **No second copy.** The backend's library root equals the studio's open root; stopping the studio
   closes the backend and removes the locator.

## Open decisions

- **D-128** Local backend and toolkit boundary: loopback-only, per-run token, read tools by default,
  writes opt-in. Accepted by author direction on 2026-10-26; implementation follows this spec.
- **D-129** Remote agent access: deferred. A tunnel or hosted MCP endpoint would change the custody
  and authentication model and needs its own ADR.
