# Tasks: library organization, goals and source-anchored notes

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. Every implementation task that depends on an open decision stays blocked until
that decision is accepted through the public decision process. A decision blocks only its dependent
work. Tests use synthetic isolated fixtures unless separately authorized.

## Phase 1 — Resolve dependent decisions

- [ ] T001 Resolve OD-033-01 with a per-data-type storage/versioning matrix for collections, recent
  entries, goals and annotations. Keep collections, goals and annotations in ordinary library
  files; decide whether recent pointers are library-scoped or disposable local preferences. Define
  schema/version and size limits, checked atomic-write/conflict behavior,
  corruption/future-version behavior, and portable-archive and chosen-folder sync treatment.
  Record the accepted public decision and any required ADR or
  `docs/FORMAT.md` change before dependent persistence work. This gates T004 and the persistence
  portions of T005–T008; it does not block independent view-model or interaction design.
  Research recorded 2026-11-03 (not accepted): `research/storage-matrix.md` compares per-type
  placement with synthetic evidence; D-166 proposes the matrix (library-root collections,
  disposable recent pointers, per-book goal/annotation sidecars), D-168 stays Open.
  T004–T008 remain blocked.
- [ ] T002 Resolve OD-033-02: collection identity, name uniqueness, one-versus-many membership,
  idempotent add/remove behavior, and same-identity book trash/restore handling. Record the public
  decision before collection persistence. Blocks T005 only.
  Research recorded 2026-11-03 (not accepted): `research/collection-identity.md` proposes
  many-to-many id-ref membership, case-insensitive unique names, stable `col_` identity and
  id-lookup trash handling with synthetic evidence; D-167 Proposed. T005 remains blocked.
- [ ] T003 Resolve OD-033-03: serialized passage anchor, source verification, stale detection,
  navigation and explicit re-anchor behavior. Test unchanged, edited, moved, repeated, missing,
  Unicode and line-ending cases with synthetic chapters. Record the public decision before
  annotation persistence/navigation. Blocks T008 only.
  Research recorded 2026-11-03 (not accepted): `research/source-anchors.md` proposes exact
  ordered verification over `(chapterId, version, hash)` plus excerpt-at-range with synthetic
  evidence (no fuzzy fallback); D-168 Proposed. T008 remains blocked.

## Phase 2 — Shared checked data services

- [ ] T004 After T001, define validated, versioned records and service operations for the accepted
  storage locations in the shared core/library boundary. Use the existing library port and checked
  atomic write path; refuse corrupt, unsupported-future or stale-base writes without replacing old
  bytes. Add in-memory and temporary-library tests for round-trip, idempotence, conflict, failure,
  path safety and schema refusal. Do not add a database-only source of truth.

## Phase 3 — Author-facing surfaces

- [ ] T005 After T001, T002 and T004, add collection create, rename, remove, membership and empty
  states to the existing library view. Cancel preserves the last saved state; removing a collection
  never trashes a book. Test with synthetic libraries and assert every manuscript file is unchanged.
- [ ] T006 After T001 and T004, add a “Continue writing” list driven only by successful explicit
  book opens. De-duplicate by stable identity, order newest-first, make unavailable references
  dismissible, and keep the book usable when recent-data writes fail. Test reopen, missing identity,
  trash/restore and failed-write cases with synthetic libraries.
- [ ] T007 After T001 and T004, add one optional total-word goal per book and show saved words and
  remaining words in the library/workspace. Use the existing counter; show any draft estimate
  separately. Test below/met/exceeded goals plus dirty, pending, failed, conflicting and incomplete
  saved states with synthetic chapter text.
- [ ] T008 After T001, T003 and T004, add bookmark/note create, inspect, edit, open, explicit
  re-anchor and remove flows. Require a confirmed saved source; retain stale entries and their
  notes without selecting a guessed passage. Assert annotation operations do not change chapter
  bytes, version or prose. Test source changes, duplicate passages, missing chapters, cancel and
  failed writes with synthetic fixtures.

## Phase 4 — Preserve existing journeys and integrate

- [ ] T009 Integrate the new surfaces without replacing spec 002's canonical library listing,
  existing search scope, shared counts, update ordering or trash/restore. Verify deleting/restoring
  a book continues through the existing recoverable trash path and does not match another book by
  title.
- [ ] T010 Check onboarding and mobile integration against specs 002 and 014: no new onboarding
  flow or blocked create/open/import journey; no duplicate mobile shell; preserve existing
  navigation, safe areas, keyboard access and touch targets. Use synthetic content at 393 × 852,
  744 × 1133 and 1440 × 900, and check no horizontal overflow.

## Phase 5 — Boundary verification and documentation

- [ ] T011 Run the affected shared-core, component, typecheck, build and isolated smoke journeys.
  Verify storage write failures preserve the old record, stale anchors never select unrelated text,
  drafts never appear as saved goal progress, and no test touches a real profile or manuscript.
- [ ] T012 Update `docs/FORMAT.md`, the accepted public decision/ADR records and any owning spec
  integration notes to match the chosen storage, schema, archive and anchor behavior. Update the
  public roadmap and changelog only as part of a separately authorized implementation delivery.

## Dependencies

- T001 gates persistent storage work for all four data types; it does not block isolated UI design.
- T002 gates collection persistence and membership behavior only (T005).
- T003 gates source-anchor persistence, navigation and re-anchoring only (T008).
- T006, T007 and T008 use the checked services from T004 and do not add a writer for chapter text.
- T009–T010 preserve the ownership in specs 002 and 014; they do not duplicate those journeys.
- T011–T012 follow the accepted decisions and implementation; all tests remain isolated and
  synthetic unless a separate authorization changes that boundary.
