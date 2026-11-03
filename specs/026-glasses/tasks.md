# Tasks: the glasses

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — The shapes

- [x] T001 Render the studio's catalog as a WebMCP tool list: names, descriptions, the stringified
  JSON Schema and the annotations.
- [x] T002 Render it as a Meta AI connector manifest: every tool classified Read or Write, the
  destructive ones marked sensitive, with the side effects and the error behaviour.
- [x] T003 Leave out a name WebMCP would reject, rather than mangle it.
- [x] T004 Serve both from the toolkit, so the manifest describes the tools a live studio is
  actually running: `bookwriter tools --format webmcp` and `--format connector`.

## Phase 2 — Reaching the studio

- [x] T005 Serve the glasses page from the studio itself, so it is the same origin as the API and
  needs no cross-origin request and no public host.
- [x] T006 Allow a browser origin that is the studio's own, and refuse every other one, exactly
  as before. The list of extra origins is empty by default.
- [x] T007 Put the per-run token in the URL fragment, which a browser never sends to a server, and
  keep the page itself free of prose and of the token.
- [x] T008 Leave a tool the author withdrew out of the per-book catalog, so the page never sees it.

## Phase 3 — The Web App

- [x] T009 Build the 600×600 page: dark, no scrolling, the arrow-key focus ring, the chapter
  list and the current passage.
- [x] T010 Speak the current paragraph and the agent's reply through `speechSynthesis`, and keep
  the text visible.
- [x] T011 Register the studio's read tools as WebMCP tools through `document.modelContext`, and
  keep every one of them reachable by hand in the interface.
- [x] T012 Work without WebMCP, without speech and without a network, and say so.
- [x] T013 Ask the wearer before a write, every time, and do not write when they say no.

## Phase 4 — Proof

- [x] T014 Drive the page in a real browser at 600×600 against the real studio: `bun run
  glasses:check`. Twenty-one checks, no dead ends.
- [x] T014a Prove the assistant's half without the hardware: a stub model context records what the
  page registers, and one of those tools is called through the assistant's own path and comes back
  with the book. The read verbs are there, the write verb is marked as a write, and the destructive
  tools are not offered to an assistant at all.

## Phase 5 — The connector

- [x] T015 Write the connector application note: the manifest, the account-linking story, the
  scopes, the side effects and the test credentials.
  Implemented: `specs/026-glasses/connector-application.md` records the fixed manifest head
  (name, description, OAuth account-linking strings, three scopes), the 22-tool
  classification with the 7 sensitive names, per-tier side effects and the uniform refusal
  behavior, the unwired account-linking story with its ordered prerequisites, and a
  credentials-free test story (loopback backend, sample library, `bookwriter mcp`,
  `glasses:check`, the 024 round trip). An excerpt was rendered from the real
  `surfaces.ts` functions to verify every quoted string. No application sent: no public
  endpoint exists (D-155, D-157).
- [x] T016 Record the WebMCP and connector surfaces in `docs/TOOLKIT.md` and the changelog.
  Implemented: `docs/TOOLKIT.md` now records the tier-to-shape mapping, the six read
  and seven sensitive tool names, the per-tool side-effects/refusal contract, the
  leave-out name rule, and a pointer to the application note with its no-submission
  status. Resolved after landing: `untrustedContentHint` was `false` while both the
  code comment and the WebMCP annotation semantics ("output contains data that is
  untrusted", i.e. user-generated or third-party text the caller must treat as
  data) call for `true` — book prose is author-supplied text the studio did not
  write. Now `true` on every tier in `surfaces.ts` and the glasses page, pinned by
  the annotations test.

## Phase 6 — The real glasses

- [ ] T017 Host the page on a public HTTPS URL and load it on the glasses through the Meta AI
  app's Developer Mode. **The page holds no prose, so hosting it exposes nothing.**
- [ ] T018 Build the phone app that is the server and the glasses the client, so the author's own
  book reaches the glasses without a public endpoint. **This is the Device Access Toolkit route,
  and it is a native app.**

## Dependencies

- T001–T004 need no key, no network and no glasses. They are done.
- T005–T014 need no key, no network and no glasses. They are done.
- T017 needs the glasses, the Meta AI app in Developer Mode and a public host for the shell.
- T018 needs a native iOS or Android app and the glasses.
