# Tasks: agent tool parity

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — The catalog

- [x] T001 Export the read and destructive tool sets from `agent/tools.ts` and build the approval map
  from the destructive set, so the app and the toolkit share one list.
- [x] T002 Add `chapterToolCatalog()`: name, description, JSON Schema and tier for every tool.
- [x] T003 Add `agent/tool-bridge.ts`: bind the tools to one book, validate the arguments with the
  tool's own schema, return the result unchanged.
- [x] T004 Record a checkpoint for every third-party change so the app can revert it.

## Phase 2 — The backend

- [x] T005 Add `GET /v1/tools` to the loopback backend.
- [x] T006 Add `POST /v1/books/:bookId/tools/:tool`, with the destructive opt-in required by FR-006.
- [x] T007 Let an isolated test run start the backend (`STUDIO_BACKEND=1`) with its own locator file.

## Phase 3 — The toolkit

- [x] T008 Add `tools()` and `callTool()` to the backend client.
- [x] T009 Mirror the studio's tools in the MCP server: the schema gains `bookId`, the tiers map to
  the flags, and the old thin read tools are replaced by the studio's own.
- [x] T010 Add `bookwriter tools` and `bookwriter call`, and `--allow-destructive` to the CLI.

## Phase 4 — Proof and documentation

- [x] T011 Add the end-to-end test: a real backend, a real `bookwriter mcp` process over stdio, a
  read → append → read round trip verified on disk.
- [x] T012 Add the focused tests for the catalog, the tiers, the bridge and the backend routes.
- [x] T013 Document the parity in `docs/TOOLKIT.md`, the README, the changelog and the hackathon plan.
- [x] T014 Verify the whole suite, the builds and the toolkit build; commit and push to Gitea.

## Phase 5 — The interface

- [x] T015 Add `scripts/ui-audit.mjs`: it drives the real app through the main flows and reports
  every dead end it finds.
- [x] T016 Fix the model picker's empty state, which pointed at a "Connections window" that does not
  exist and offered no way to reach the place where a key is added.
- [x] T017 Fix the failed turn in the agent panel, which offered only "Retry request" and so stranded
  the author's prompt when no model was chosen.
- [x] T018 Cover both fixes in the smoke test and the UI audit.

## Dependencies

- T001–T018 are unblocked; no provider key, device or recording is needed.
