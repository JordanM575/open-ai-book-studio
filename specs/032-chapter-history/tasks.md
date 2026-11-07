# Tasks: chapter history

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. `[P]` means safe to do in parallel within a phase. Storage and retention decisions
are accepted; T002 records decision completion only. T001 still needs format/ADR follow-through and
all implementation/acceptance tasks remain unchecked. Named chapter history is not built.

## Phase 0 — Resolve only the decisions needed by each task

- [ ] T001 Resolve **OQ-001**: compare storage layouts and schemas for author-owned snapshot bodies,
  provenance, safety copies, and restore-undo records; decide how the data participates in the
  existing archive and chapter trash/restore lifecycle. Record a public decision (and ADR/format
  changes where needed) before starting dependent persistence work. This task does not authorize
  editing those documents as part of spec authoring.
  Accepted 2026-11-03 in D-175: `research/storage-layouts.md` pins the
  book/chapter/conflict/trash/archive facts against six alternatives:
  book-scoped `books/<bookId>/history/<chapterId>/` records mirroring chapter files (front
  matter plus body, loose schemas, newer-schema refusal), riding archive and whole-book trash
  by construction, staying keyed by stable id across chapter trash, with author deletion to
  chapter trash. The decision portion is complete; the required format/ADR follow-through remains
  before dependent persistence, so T001 stays unchecked.
- [x] T002 [P] Research and resolve **OQ-002**: decide retention, size-limit, and cleanup behavior,
  including restore-undo dependencies and safe recovery. Do not choose an age/count period by
  assumption. This decision blocks only T011; it is not a prerequisite for core snapshot and
  restore work.
  Accepted 2026-11-03 in D-176: `research/retention.md` pins unbounded
  trash/conflicts, failure preservation, and transport-only caps against auto-prune, count,
  age, and quota alternatives: no automatic pruning with trash-based
  explicit deletion and stat-based size visibility. T011's implementation remains open.

## Phase 1 — Shared snapshot contract

- [ ] T003 **After T001's format/ADR work under D-175.** Define validated history record and operation types in the
  existing shared library service. Bind each record to book ID, chapter ID, source version, raw
  chapter-file hash, body hash, label, and capture time. Keep bodies and metadata in the decided
  author-owned format; reject wrong identity, unsupported schema, and corrupt bodies without
  rewriting them. Add synthetic tests through the in-memory library port.
- [ ] T004 **After T003.** Implement explicit snapshot creation and chapter-scoped list,
  open, and compare operations using only the existing checked library service/port. Verify
  creation requires a confirmed saved source and that list/open/compare do not mutate chapter
  bytes or flush drafts. Cover duplicate labels and malformed/missing records with synthetic
  fixtures.

## Phase 2 — API and author-facing history

- [ ] T005 Expose history operations through the existing validated IPC/shared-runtime boundary.
  Keep filesystem access out of the renderer and use the shared library service for desktop and
  browser targets. Add contract tests for invalid IDs, labels, and request/result errors.
- [ ] T006 Add a chapter history entry point and read-only list/open/compare UI using existing
  shared components and token conventions. Show labels, capture times, source versions, corrupt or
  unavailable states, and whether a comparison excludes an unsaved editor draft. Test author-visible
  outcomes and keyboard/focus behavior with synthetic chapters.

## Phase 3 — Checked restore and its undo

- [ ] T007 **After snapshot storage under D-175.** Implement restore preflight and confirmation: require explicit
  resolution of pending drafts, show the saved current body and selected snapshot, and retain the
  current saved body as a visible safety snapshot before writing. If safety-snapshot creation
  fails, prove that the chapter remains unchanged.
- [ ] T008 **After T007.** Restore only the snapshot body with the current read's
  `baseVersion` and `baseHash` through the existing checked chapter writer. Preserve metadata and
  normal conflict behavior. Test stale/external changes, cancellation before and after the safety
  snapshot, write failure, delayed result, and draft preservation with the in-memory writer and
  isolated synthetic libraries.
- [ ] T009 **Required with T008 before exposing restore.** Persist a restore-specific undo tied to the exact committed
  post-restore version/hash. Persist a prepared intent before chapter commit and reconcile it after
  interrupted finalization; undo through the same checked writer, refuse a stale undo, and retain
  all snapshot material. Test success, reload, interrupted finalization, stale base, second writer,
  and recovery of both versions using synthetic fixtures.
- [ ] T010 Add explicit success, stale, canceled, and failed states to the restore UI. A confirmed
  commit may update a clean editor only as an identified restore result; a racing draft remains
  visible and is not flushed or replaced. The interface must not report a commit as canceled or
  blindly retry an uncertain result.

## Phase 4 — Retention, lifecycle, and integration

- [ ] T011 **Under accepted D-176.** Implement the accepted snapshot size/retention/cleanup
  behavior. Preserve required restore-undo data, make any destructive cleanup author-visible and
  recoverable, and test policy boundaries with synthetic snapshots. No automatic pruning, quota,
  expiry or compaction is authorized; include unapplied intents in preservation tests.
- [ ] T012 **Under accepted D-175, after storage exists.** Verify the selected snapshot layout follows chapter identity
  through rename/reorder and follows existing trash/restore behavior; verify portable archive
  export/import preserves history records and hashes without making archive import a chapter
  history action. Update format/archive documentation only as required by the accepted decision.
- [ ] T013 [P] Cover storage-full, permission-loss, corrupt record, wrong identity, cancellation,
  interrupted response, and stale restore/undo paths at library boundaries. Use only the existing
  checked library writer, synthetic fixtures, the in-memory port, and isolated temporary
  libraries; never use real manuscripts, credentials, live providers, paid services, or devices.

## Phase 5 — Verification and documentation

- [ ] T014 Run relevant unit/contract tests, typecheck, and isolated desktop/browser smoke journeys.
  Confirm the existing editor undo, agent-turn checkpoint, archive, and sync-conflict journeys are
  unchanged. Record actual results; do not claim acceptance until they pass.
- [ ] T015 Update the public format, archive references, decision record, spec index, and changelog
  as required for the implemented storage choice. Keep chapter history described separately from
  editor undo, agent-turn checkpoints, whole-library archives, and sync conflicts.

## Dependency notes

- OQ-001 is resolved by D-175. T001's format/ADR follow-through and T003's schema still precede
  persistence; archive/trash tests accompany the first durable snapshot slice.
- OQ-002 is resolved by D-176. T011 implements that policy; all paths report storage failures
  without pruning existing data. The decision checkbox is not implementation acceptance.
- Every test fixture is synthetic and isolated. No task authorizes access to real manuscripts,
  credentials, live providers, paid services, or devices.
