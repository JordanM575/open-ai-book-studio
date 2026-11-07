# Plan: chapter history

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Status

Planned implementation. D-175/D-176 accepted the storage/retention decisions on November 3, 2026
with delivery deferred until after submission. Existing premise tests are decision evidence;
capture/list/restore and their end-to-end acceptance remain unimplemented.

## Shape

Add chapter-scoped history to the shared library service, then expose it through the existing
application boundary and workspace. Snapshot reads are read-only. All persistent history writes
stay in the existing library service and storage port; chapter replacement and restore-specific
undo use the existing checked chapter writer. No renderer filesystem access or parallel writer is
introduced.

The snapshot body is the canonical saved Markdown body. Its provenance records the stable book and
chapter IDs, source version, and raw chapter-file hash. A separate body hash verifies the stored
snapshot. D-175 chooses `books/<bookId>/history/<chapterId>/` with separate snapshot, safety and
intent records. Complete T001's format/ADR follow-through and T003's field-level schema and label
grammar before persistence; do not treat the accepted layout as a finished serializer.

## Architecture

### Shared history operations

Add a chapter-history operation to the existing shared library service over `LibraryPort`:

- read/list history for one stable chapter identity;
- create an explicitly named snapshot only from a confirmed saved chapter read;
- open and compare stored bodies without changing the chapter or editor draft;
- validate record identity and body hash before displaying or using a snapshot;
- retain a pre-restore safety snapshot before attempting a restore; and
- persist the restore-specific undo material and its expected committed version/hash.

All file access remains library-relative and path-validated. Snapshot records are ordinary,
author-owned library data, not a disposable index. The chosen layout must participate in the
portable archive and existing chapter trash/restore lifecycle; update `docs/FORMAT.md` and the
archive contract as required by D-175 (the accepted OQ-001 decision).

### Checked restore and undo

For a restore, obtain the **current** chapter version/hash from the checked service. Create and
confirm the pre-restore safety snapshot first. Then pass the selected snapshot body to the ordinary
chapter save operation with the current read's `baseVersion` and `baseHash`. The snapshot's
historical source version/hash prove provenance; they are never used as the restore's write base.

The normal writer remains responsible for atomic replacement and stale-write conflict handling.
Before starting it, persist both the safety snapshot and a prepared restore intent that identifies
the selected snapshot and checked base. If either cannot be committed, do not start the chapter
write. If the chapter write fails or reports a conflict, keep the selected snapshot, any committed
safety snapshot and intent, current chapter, and draft. Do not make a second write path to simplify
this flow.

On a confirmed restore, finalize the intent as an undo action that refers to the pre-restore body
and exact version/hash just written. If finalization is interrupted after chapter commit, leave the
prepared intent durable. On the next history read, reconcile it with a checked chapter read before
offering retry or undo; never replay the restore blindly. Undo reads the current chapter again and
uses that exact post-restore version/hash as its checked base. A mismatch refuses the undo; it never
overwrites intervening text. The snapshot used for the restore remains intact.

Cancellation before the first persistent write changes nothing. If cancellation arrives after the
safety snapshot and prepared intent commit but before the chapter write begins, keep those history
records, leave the chapter unchanged, and report the canceled restore. Once the checked chapter
writer begins, wait for its definitive saved/conflict/failure outcome instead of claiming it was
canceled.

### Editor and interface boundary

Expose the operations through the current validated IPC/shared-runtime contracts. Desktop file
access stays in the main process; browser targets use the shared storage service. The chapter
workspace gets a history entry point, a read-only list/open/compare surface, a confirmation step for
restore, and a restore-specific success/undo action. Use the existing tokenized components and
keyboard/focus patterns; no new visual system is proposed.

Browsing and comparison do not flush drafts. Restore is unavailable while a draft is pending until
the author resolves it through the normal editor controls. If new typing races with a confirmed
restore, retain that draft and mark it for normal reconciliation; never replace it or flush it as
part of history. Only after a confirmed commit may a clean editor show the restored body, with an
explicit success state.

### Accepted policies and delivery checkpoints

1. **Contract first (T001/T003):** carry accepted D-175 into the format/ADR and detailed schema,
   including collision-safe labels, record identity, body hashes and intent states. Test malformed,
   foreign, newer-schema and unknown-field records without rewriting them.
2. **Saved-only history (T004–T006):** capture/list/open/compare through the library port and shared
   UI; prove unchanged chapter bytes and drafts. Validate archive and chapter/whole-book trash
   behavior with T012 before presenting history as durable author-owned data.
3. **Restore and recovery (T007–T010/T013):** commit safety copy and prepared intent before the
   checked chapter write; prove cancel, conflict, uncertain response and failed finalization cases.
   Offer undo only against the confirmed post-restore version/hash. Retain every recovery record.
4. **Retention and acceptance (T011–T015):** D-176 allows stat-based size visibility and explicit
   deletion to trash, not automatic pruning or quotas. Test dependency preservation, keyboard paths,
   existing undo/archive journeys and exact-candidate gates before marking the feature implemented.

## Proposed project areas

These are implementation targets, not existing feature files or evidence of completed work:

- `packages/core/src/library/` — shared history records and operations over the current service/port.
- `packages/core/tests/` — synthetic in-memory-port behavior and failure cases.
- `apps/desktop/src/main/ipc.ts` and preload/API contracts — validated history requests/results.
- `packages/app/src/` and desktop renderer — chapter history list, read-only comparison, restore
  confirmation, and undo feedback.
- Browser API/UI integration where the shared workspace exposes the same chapter actions.
- `docs/FORMAT.md` and spec 010 archive contract — only as required by the accepted storage
  representation.

## Verification approach

Use only synthetic chapter fixtures with deterministic identities and bodies, the existing checked
library writer, the in-memory library port, and isolated temporary libraries. Inject storage and
commit failures at each boundary. Assert file bytes, version/hash checks, draft preservation, and
author-visible operation states. Do not inspect real libraries or use credentials, providers,
devices, or paid services.

Required checks include:

- round-trip snapshot body and provenance; reject wrong chapter/book identity and invalid body hash;
- read-only list/open/compare with both clean and dirty synthetic editor states;
- safe snapshot creation from a confirmed saved source only;
- restore and undo through the existing checked writer, including stale bases and external edits;
- safety-snapshot failure, chapter-write failure, cancellation before and after the safety copy,
  failed undo-record finalization, quota/permission error, and interrupted response without loss or
  false success;
- archive round-trip and chapter trash/restore behavior for the selected author-owned layout;
- keyboard-only, focus, reduced-motion/transparency, and both light/dark interface states; and
- existing library tests and the applicable desktop/browser smoke journeys.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A restore races with an external or agent save. | Use current base version/hash and the existing checked writer; preserve snapshots and report a normal conflict. |
| The editor has a draft that differs from saved text. | Never flush it from history; block restore until explicit resolution and retain any draft that races with the operation. |
| Restore replaces text but loses the prior saved body. | Commit a visible safety snapshot first; abort restore if that write fails. |
| Snapshot record is corrupt or attached to another chapter. | Validate stable identity and body hash; report unavailable and do not rewrite it or the chapter. |
| Snapshot persistence is hidden from library backup or trash. | Implement D-175's ordinary-file layout and prove archive/whole-book trash travel and stable chapter identity. |
| History growth consumes storage. | D-176 requires size visibility and explicit recoverable deletion, with no automatic pruning/quota; report write failures without deleting existing data. |
| Restore-specific undo overwrites later prose. | Bind undo to the exact post-restore version/hash and refuse stale undo. |

## Constitution check

- **Author's files are the product:** Pass only if snapshot data is ordinary author-owned library
  data and is covered by the accepted D-175 format/archive lifecycle.
- **One writer, checked:** Pass. Every persistent operation uses the current library service/port;
  chapter restore and undo use the existing checked writer.
- **Local-first, no custody:** Pass. Snapshots remain local library data; no network or telemetry is
  added.
- **Honest interface:** Pass if draft, save, stale, cancel, and failure outcomes are explicit and
  no failed or unconfirmed write is shown as saved.
- **Designed, not assembled:** Pass if the history surface uses current tokens, focus, keyboard,
  reduced-motion, and reduced-transparency conventions.
- **Tests at boundaries:** Pass only after the synthetic checked-writer and isolated-library tests,
  typecheck, and relevant smoke tests are run during implementation; this spec does not claim them.
