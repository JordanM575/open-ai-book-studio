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

- [ ] T005 Let the author allow one exact browser origin on the loopback backend, off by default,
  with CORS headers and the per-run token unchanged.
- [ ] T006 Show the origin and the URL in Settings, and say plainly that the page carries the
  token and that the token never leaves the machine.

## Phase 3 — The Web App

- [ ] T007 Build the 600×600 page: dark, no scrolling, the arrow-key focus ring, the chapter
  list and the current paragraph.
- [ ] T008 Speak the current paragraph and the agent's reply through `speechSynthesis`, and keep
  the text visible.
- [ ] T009 Register the studio's read tools as WebMCP tools through `document.modelContext`, and
  keep every one of them reachable by hand in the interface.
- [ ] T010 Work without WebMCP, without speech and without a network, and say so.

## Phase 4 — The connector

- [ ] T011 Write the connector application note: the manifest, the account-linking story, the
  scopes, the side effects and the test credentials.
- [ ] T012 Record the WebMCP and connector surfaces in `docs/TOOLKIT.md` and the changelog.

## Phase 5 — The real glasses

- [ ] T013 Host the page on a public HTTPS URL and load it on the glasses through the Meta AI
  app's Developer Mode.
- [ ] T014 Publish a studio instance serving the sample library only, and point the page at it.
  **Blocked on D-157.**

## Dependencies

- T001–T004 need no key, no network and no glasses. They are done.
- T005–T010 need no key and no network, and can be developed in the Meta Ray-Ban Display
  Simulator.
- T013–T014 need the glasses, the Meta AI app in Developer Mode, a public host and a decision
  (D-157).
