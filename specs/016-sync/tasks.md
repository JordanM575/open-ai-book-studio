# Tasks: sync and device trust

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md) · **Research:** [research.md](research.md)

Tasks are ordered. `[P]` means it can run in parallel with the other `[P]` tasks in the same phase.
A task blocked on an open decision must not start until it is accepted.

## Phase 1 — Journal and detector

- [x] T001 Define `SyncJournal`, `SyncFileRecord`, `DriftReport`, `DriftEntry` and their schema version in
  `packages/core/src/sync/`. Include tombstone and placeholder states; no credentials or prose.
  `types.ts` defines the journal, file observation, drift kinds and counts; the core package exports `./sync`.
- [x] T002 Read, write and prune the journal through `LibraryPort`, atomically, under the normal write
  serialisation. Exclude `.studio/sync` from archives and the catalog; add tests for a corrupt, missing and
  foreign-device journal. `journal.ts` adds `readSyncJournal`, `writeSyncJournal`, `journalForScan` and
  `pruneJournal`; corrupt, foreign and schema-mismatched journals return no baseline.
- [x] T003 Implement `detectDrift()` as a read-only pure function over a file enumeration and the journal.
  Tests cover unchanged, remote-changed, local-changed, both-changed, remote-deleted, local-deleted,
  conflict copy, placeholder, unreadable, schema-newer, rename pairing and a missing baseline. 14 tests in
  `packages/core/tests/sync.test.ts`; a repeated scan returns the same report.

## Phase 2 — Two-system harness

- [x] T004 Build `apps/desktop/tests/sync/transport.ts`: two temporary libraries, a copy/rename transport with
  delay, partial copy, offline batching, clock skew, placeholder marking and injected iCloud-style conflict
  copies. No network. `packages/core/src/sync/scan.ts` adds the read-only observation step the scenarios need:
  it scans `books/**` and `.studio/trash/**`, probes placeholders before reading, skips provider sidecars and
  transient files, and reports book schema and chapter identity from the bytes it hashes. This first pass
  hashes every materialized author file; the journal-aware stat/hash skip waits for the UI wiring (T006).
- [x] T005 Add scenario tests: clean propagation, concurrent edits, offline edits, deletion/tombstone,
  placeholder, interrupted copy, corrupt journal and repeated scans. Every scenario asserts no author bytes
  are lost, the report matches, and a second scan adds no duplicate conflicts. Ten scenarios in
  `apps/desktop/tests/sync/two-system.test.ts`. The harness found a detector bug: a chapter moved to
  `.studio/trash` has unchanged bytes and was paired as a rename. Rename pairing now excludes trash, with a
  unit test, so a deletion reports `remote-deleted` plus `new-remote`.

## Phase 3 — Drift report

- [ ] T006 Add a drift report dialog on library open and on window focus after the configured interval.
  Review is required before writing; actions are review, keep the disk version, keep mine (conflict copy),
  open both, and export. Keyboard focus and the mobile full-screen dialog follow the existing patterns.
- [ ] T007 Add a Settings section for the sync location, last scan, device name and a "Check for changes"
  action. The copy states that sync is the chosen folder's provider, not a studio account.

## Phase 4 — App lock

- [ ] T008 macOS: add an optional LocalAuthentication gate in the Electron main process, locked on launch and
  on resume. The setting explains when the device cannot evaluate a policy. No file encryption claim.
- [ ] T009 iOS: add Face ID/Touch ID through the Capacitor shell after D-121 accepts a plugin. Lock on launch
  and foreground; fall back to the device passcode where the OS allows it.
- [ ] T010 Optional PIN: keychain-protected verifier, random salt, slow KDF, attempt counter, delay and
  fallback. No recovery code. Tests cover wrong PIN, lockout, keychain loss and disabling the lock.
- [ ] T011 Manual pass on macOS: enable the lock, relaunch, cancel, unlock, sleep/wake. Confirm the files
  remain readable in Finder and the agent/CLI is unaffected.

## Phase 5 — Real providers and docs

- [ ] T012 **Blocked on D-122.** Two-device pass with iCloud Drive (Mac + iPad) and Google Drive (mounted
  folder). Record provider versions, placeholders observed, conflict-copy names and results in
  `docs/research/sync-provider-results.md`.
- [x] T013 Update `docs/FORMAT.md` for `.studio/sync/`, `docs/ARCHITECTURE.md` for the detector and lock,
  `docs/DECISIONS.md` for D-120–D-123, `specs/README.md`, and `CHANGELOG.md`. FORMAT already documents
  the journal; ARCHITECTURE now documents the scan/detector/harness and records that the lock and review
  UI are not built; D-120 carries the harness evidence. The lock remains pending D-121 and the UI T006–T007.

## Dependencies

- T001–T005 are unblocked now and can be built without iCloud, Google Drive, or any native API.
- T006–T007 depend on T001–T003.
- T008–T010 depend on **D-121** (lock scope, PIN policy, iOS plugin).
- T012 depends on **D-122** (provider scope and placeholders) and real devices.
- T013 follows the accepted decisions and the manual pass.
