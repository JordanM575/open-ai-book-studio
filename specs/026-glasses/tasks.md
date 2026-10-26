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
  glasses:check`. Twelve checks, no dead ends.

## Phase 5 — The connector

- [ ] T015 Write the connector application note: the manifest, the account-linking story, the
  scopes, the side effects and the test credentials.
- [ ] T016 Record the WebMCP and connector surfaces in `docs/TOOLKIT.md` and the changelog.

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
