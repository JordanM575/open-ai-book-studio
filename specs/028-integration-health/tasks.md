# Tasks: integration health

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. A task blocked on an open decision must not start until it is accepted.

## Phase 1 — Derive the states (core, no UI)

- [x] T001 Add `locationHealth()` in `packages/core/src/sync/health.ts`: the state, count and safe action
  for a location, from the detector's observations. Tests cover ready, not downloaded, offline,
  permission needed, conflicts and checking, using fixture folders.
- [x] T002 Add `providerStatus()` in `packages/core/src/providers/status.ts`: the five connection states
  from a last check. Tests assert that no output contains the key, for each state.
- [x] T003 Put the copy for every state and severity in one table, sentence case, with no raw error
  text. Tests fail when a state has no copy or no action.

## Phase 2 — One warning component

- [x] T004 Extend the notice component with severity (info, warning, danger), an icon per severity and
  at most two actions. A danger notice has no dismiss timer. Test the three severities in the renderer
  tests.
- [x] T005 Show location health in the library list and the settings location section. Depends on 016
  T007, which adds that section; until then, show the health line in the library list only.
  Implemented the library-list half: `LibraryService.locationHealth()` (fresh read-only
  `scanLibrary` + `readSyncJournal` through the existing `locationHealth()` derivation),
  new `library:locationHealth` channel (core `IpcChannelMap`/`StudioApi`, desktop handler +
  `Library` delegate + preload, web runtime over its own port), and a `location-health`
  caption line under the library root in `LibraryView` (`label · message`, destructive
  label for danger states, silent on check failure via `onNotice`). No action buttons yet:
  they arrive with the 016 T007 settings section and drift UI. Covered by
  `packages/core/tests/location-health-service.test.ts` (ready, unreviewed/reviewed
  conflict, unreadable chapter) and `apps/desktop/tests/library-health.test.tsx`
  (ready, danger, failed check, library-switch refresh); hidden smoke asserts the Ready
  line on the fixture library. 016 T007 still owns the settings section.
- [x] T006 Show provider and voice status in the provider settings, with the last check time.
  Shipped per recorded D-161: provider status derives from the author's last explicit Test only
  (failure codes mapped through `providerStatus()`), with a volatile check time that clears whenever
  Settings opens; voice shows configured read-aloud/dictation availability with no check time and
  states it is never tested automatically. A passed Test shows connected with the check time instead
  of claiming an unchecked provider is ready; key-rejected renders the redacted safe message.
  Covered by `apps/desktop/tests/settings-status.test.tsx` (untested, connected, key-rejected with
  redaction, volatility, and both voice states).

## Phase 3 — Block what could lose data

- [x] T007 Disable saving over a placeholder chapter until the author picks keep disk, keep mine or open
  both. The test drives the real editor, not a stub. Implemented as a save-time guard on the
  provider-agnostic placeholder signal (chapter file listed but unreadable): `saveChapter` routes
  through a new `locateChapterForWrite`, and an unreadable target preserves the author's text as a
  `conflict-placeholder` copy with a new `placeholder` reason instead of overwriting or failing raw.
  The existing conflict banner offers the choices — "Show the saved copy" (open both), "Load the
  version on disk" (keep disk; the retry triggers the provider download), and the untouched editor
  text (keep mine) — with placeholder-specific copy in `WorkspaceView` and `ReviewGateDialog`.
  Meta-only edits are unchanged: without body text no copy can be preserved, so they keep the loud
  failure. Covered by `packages/core/tests/placeholder-save.test.ts` (blocked save preserves the
  copy and leaves the original bytes untouched; readable save unaffected) and
  `apps/desktop/tests/placeholder-save.test.tsx` driving the real `WorkspaceView` autosave
  (banner copy, both buttons, editor text retained, single save attempt, no notice). No new
  detection heuristics: the signal is read-failure-on-listed-file, and real-folder placeholder
  shapes stay with T008.

## Phase 4 — Evidence

- [ ] T008 Record read-only probes of the real iCloud Drive and Google Drive folders in
  `docs/research/`: names, placeholder status, counts. No file is written. Needs the author's
  go-ahead to run on their machine.
