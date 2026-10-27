# Tasks: integration health

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. A task blocked on an open decision must not start until it is accepted.

## Phase 1 — Derive the states (core, no UI)

- [ ] T001 Add `locationHealth()` in `packages/core/src/sync/health.ts`: the state, count and safe action
  for a location, from the detector's observations. Tests cover ready, not downloaded, offline,
  permission needed, conflicts and checking, using fixture folders.
- [ ] T002 Add `providerStatus()` in `packages/core/src/providers/status.ts`: the five connection states
  from a last check. Tests assert that no output contains the key, for each state.
- [ ] T003 Put the copy for every state and severity in one table, sentence case, with no raw error
  text. Tests fail when a state has no copy or no action.

## Phase 2 — One warning component

- [ ] T004 Extend the notice component with severity (info, warning, danger), an icon per severity and
  at most two actions. A danger notice has no dismiss timer. Test the three severities in the renderer
  tests.
- [ ] T005 Show location health in the library list and the settings location section. Depends on 016
  T007, which adds that section; until then, show the health line in the library list only.
- [ ] T006 Show provider and voice status in the provider settings, with the last check time.

## Phase 3 — Block what could lose data

- [ ] T007 Disable saving over a placeholder chapter until the author picks keep disk, keep mine or open
  both. The test drives the real editor, not a stub.

## Phase 4 — Evidence

- [ ] T008 Record read-only probes of the real iCloud Drive and Google Drive folders in
  `docs/research/`: names, placeholder status, counts. No file is written. Needs the author's
  go-ahead to run on their machine.
