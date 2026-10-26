# Tasks: agent toolkit

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. `[P]` marks work that can run in parallel within a phase.

## Phase 1 — Backend

- [x] T001 Add `apps/desktop/src/main/backend.ts`: loopback listener, per-run token, owner-only
  locator, host/origin/auth checks, body limit, JSON errors and the read/search routes.
- [x] T002 Add the checked save, create-chapter and conflicts routes over `Studio.requireLibrary()`.
  No second writer; return the library's conflict result unchanged.
- [x] T003 Start the backend after `Studio.restore()` and stop it in the quit chain; skip it in
  headless/test runs. Write a fake-source test for auth, origin, host, 404, 409, 413 and save.

## Phase 2 — Client and CLI

- [x] T004 Add `apps/toolkit/src/backend-client.ts`: locator discovery, environment/flag overrides,
  loopback validation, bearer fetch and one readable error for a closed studio.
- [x] T005 Add `apps/toolkit/src/cli.ts` with `info`, `books`, `read`, `search`, `conflicts`,
  `create-chapter`, `save` and `mcp`; support `--json` and content from a file or stdin.
- [x] T006 Add `apps/toolkit/package.json` with the `bookwriter` bin, a `typecheck` script and a Bun
  compile script. Link it into the workspace and run the compiled binary in a smoke check.

## Phase 3 — MCP

- [x] T007 Add `apps/toolkit/src/mcp.ts`: newline-delimited JSON-RPC 2.0, `initialize`,
  `notifications/initialized`, `ping`, `tools/list`, `tools/call`, protocol errors and `isError`
  results.
- [x] T008 Define the read tools; gate `create_chapter` and `save_chapter` behind `--allow-writes`.
  Serialize results as JSON text and keep diagnostics on stderr.
- [x] T009 Add MCP tests for initialize, tool discovery, a read call, a write call with and without
  the flag, unknown method, invalid JSON and a backend refusal.

## Phase 4 — Evidence and docs

- [x] T010 Add the backend/toolkit sections to `docs/ARCHITECTURE.md`, D-128/D-129 to
  `docs/DECISIONS.md`, the CLI/MCP quickstart to `README.md` or `docs/DEPLOYMENT.md`, and the spec link
  to `specs/README.md`.
- [x] T011 Manual pass with the desktop app open: `bookwriter books`, read/save, MCP initialize and a
  read tool from a real client. Record it in `docs/research/toolkit-2026-10-26.md`. The pass ran the
  compiled binary against a real backend over a real library, and a separate MCP client process
  drove a read and a write that were read back from the file.

## Dependencies

- T001–T009 need no model key.
- T011 needs the desktop app running with a sample library and an MCP client.
- Remote access (D-129) is deferred; no task depends on it.
