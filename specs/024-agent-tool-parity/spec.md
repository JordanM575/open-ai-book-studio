# Agent tool parity: the studio's tools over the loopback backend and MCP

**Status:** In progress (2026-10-26)
**Number:** 024
**Depends on:** [018](../018-agent-toolkit/spec.md) toolkit, [017](../017-voice-and-background/spec.md) agent seams.

## Why

The built-in writing agent works because it has verbs: read the Story Bible, list the chapters,
find a phrase, append a passage, split a chapter, update a character. Today those verbs live only
inside the app, behind a model provider. A third-party agent — Claude Desktop, a local runner, a
script — can read the book through `bookwriter`, but it cannot *write* the way the built-in agent
writes: it must fetch the whole Markdown file, re-hash it and push it back.

That gap is the difference between "an API for reading files" and "another agent can work on this
book". This spec closes it by exposing the studio's own tools over the existing loopback backend,
so the MCP surface is the built-in agent's surface, not a second dialect.

## Deliverables

| Artefact | Requirement |
| --- | --- |
| Tool catalog | One source of truth: the tool names, descriptions, schemas and safety tiers of the built-in agent |
| Backend route | `GET /v1/tools` and `POST /v1/books/:bookId/tools/:tool` on the loopback control plane |
| MCP parity | `bookwriter mcp` lists the studio's tools with a `bookId` argument and calls them |
| CLI parity | `bookwriter tools` and `bookwriter call` run one studio tool against the open book |
| Undo | A third-party write leaves a checkpoint the app's Undo can revert |
| Proof | An end-to-end test drives a real MCP client over stdio against a real backend and library |

## Requirements

- **FR-001** The studio's tool catalog MUST come from the same definitions the built-in agent uses.
  The backend MUST NOT re-implement a tool.
- **FR-002** `GET /v1/tools` MUST return each tool's name, description, JSON Schema and tier.
- **FR-003** `POST /v1/books/:bookId/tools/:tool` MUST validate the arguments against the tool's own
  schema, run the tool through the open `Library`, and return the tool's result unchanged.
- **FR-004** Tool tiers are **read**, **write** and **destructive**. Destructive tools are the ones
  the built-in agent already gates behind author approval.
- **FR-005** The MCP server MUST expose read tools by default, write tools only with `--allow-writes`
  and destructive tools only with `--allow-destructive`. `--allow-destructive` implies
  `--allow-writes`.
- **FR-006** The backend MUST refuse a destructive tool unless the request carries an explicit
  destructive opt-in, so the token alone is never enough.
- **FR-007** A third-party write MUST leave an undo checkpoint in the book, so the author can revert
  it from the app with the same Undo button used for the built-in agent.
- **FR-008** The desktop app MUST remain the only process that opens the library and the only
  process that holds a provider key. The toolkit MUST NOT call a provider.
- **FR-009** `bookwriter mcp` MUST keep the read-only default and MUST NOT expose a write tool
  without the matching flag.
- **FR-010** An end-to-end test MUST start a real backend over a real library, connect a real MCP
  client over stdio, and complete a read → write → read round trip that is verified on disk.
- **FR-011** The interface MUST NOT dead-end. A screen that explains a missing connection or a
  missing model MUST offer the action that resolves it, and a failed turn MUST keep the author's
  prompt available to retry.
- **FR-012** A repeatable audit MUST drive the real app through the main flows and report any dead
  end, missing control or console error it finds.

## Non-goals

- A hosted MCP endpoint, a tunnel, an account or multi-user permissions.
- A second writer, a second copy of the library or a background sync.
- Model inference in the toolkit.
- A rewrite of the built-in agent's tool set.

## Acceptance scenarios

1. **Parity.** `bookwriter tools` lists the same tool names the built-in agent uses, with tiers.
2. **Read.** An MCP client calls `read_story_bible` and `table_of_contents` and gets the book's own
   data.
3. **Write.** With `--allow-writes`, an MCP client calls `append_to_chapter`; the Markdown file on
   disk changes and the app shows the new text.
4. **Destructive.** Without `--allow-destructive`, `overwrite_chapter` is not listed and is refused
   by the backend even if the request asks for it.
5. **Undo.** After a third-party write, the app's Undo restores the previous text.
6. **Round trip.** The end-to-end test completes a read → append → read cycle and checks the file.
7. **No dead end.** The model picker without a connection offers a way to add one, and a failed turn
   offers a way to choose a model while keeping the prompt available to retry.

## Open decisions

- **D-142** The loopback backend serves the studio's own tools; the MCP server mirrors them with a
  `bookId` argument instead of exposing a second, thinner dialect. Accepted.
- **D-143** Destructive tools need a second flag on the client *and* an explicit opt-in on the
  request, so neither the token nor `--allow-writes` alone is enough. Accepted.
- **D-144** A third-party write is undoable from the app. Accepted: the checkpoint is written before
  the change is confirmed, so a crash still leaves a restore point.
- **D-145** The old toolkit MCP tools (`read_book`, `read_chapter`, `search_book`, `create_chapter`,
  `save_chapter`) are replaced by the studio's own verbs. Accepted: one dialect is easier to reason
  about than two, and the file-level `bookwriter read`/`save` commands stay for scripts that want a
  whole-file replace with an explicit version and hash.
- **D-146** The UI audit is a script, not a test. Accepted: it drives the real app through Electron,
  so it belongs beside the capture and smoke scripts rather than in the unit suite.
