# Feature Specification: Chapter history — named saved-text snapshots

**Feature Branch**: `032-chapter-history`

**Status**: In progress — saved-only library core implemented; author-facing journey planned

## Overview

An author can name a snapshot of a chapter's saved text, browse and open snapshots without changing
the editor, compare one with the chapter's current saved text, restore a chosen snapshot after an
explicit check, and undo that restoration. The history belongs to one stable book and chapter
identity. Every snapshot records which saved chapter version and file hash it came from.

This is a reversible, chapter-level writing journey. It does not replace the ordinary editor undo
stack, an agent turn's multi-chapter checkpoint, a whole-library archive, or sync conflict review.

## Current public behavior and proposed behavior

The public product definition in [002](../002-studio-v1/spec.md) distinguishes undo/redo of the
author's typing from a single undo/checkpoint for an agent turn. The public known-gaps notes state
that the current agent implementation keeps at most one checkpoint. Neither contract provides
author-named, browsable snapshots of saved chapter text.

[010](../010-web-target/spec.md) defines a whole-library archive for backup and transfer; it is not
a chapter history browser or a chapter restore action. [016](../016-sync/spec.md) defines read-only
drift detection and review of versions changed through a synced folder; it is not a way to choose an
arbitrary past chapter version. The current chapter save contract carries a base version and raw-file
SHA-256 hash; the checked library writer refuses stale replacement and preserves a conflict.

**Proposed by this spec:** a separate chapter history surface for explicit, named snapshots of
already-saved chapter bodies, with read-only browsing/comparison, a checked restore, and a
restore-specific undo. D-175/D-176 accepted the storage and retention policies on November 3, 2026;
the saved-only library core now implements capture/list/open/compare. The author-facing journey,
restore and undo remain unimplemented; premise tests alone do not establish that journey.

## User scenarios and acceptance

### Story 1 — Keep a named version of saved text (Priority: P1)

An author has reached a meaningful point in a chapter and wants a named version they can return to
later. They save a snapshot of the chapter as it is already stored, without changing the chapter or
making an editor draft look saved.

**Acceptance scenarios**

1. **Given** a chapter has a confirmed saved version and no pending save, **when** the author names
   and saves a snapshot, **then** history identifies the same book and chapter, the saved chapter
   version and raw-file hash, the snapshot body hash, the label, and capture time.
2. **Given** the editor has unsaved text or a save/conflict is pending, **when** the author opens
   history or requests a snapshot, **then** history does not flush the draft; snapshot creation is
   unavailable until the author resolves the save state, and the draft remains available.
3. **Given** snapshot creation is canceled or fails, **when** the operation ends, **then** the
   chapter remains unchanged, no partial snapshot is listed, and the author gets a specific retry
   or recovery action.

### Story 2 — Find, open, and compare a saved version (Priority: P1)

The author can review a chapter's own history, open an older text read-only, and compare it with the
current saved body. Reviewing history never replaces the manuscript editor or saves a draft.

**Acceptance scenarios**

1. **Given** a chapter has snapshots, **when** the author opens its history, **then** the list is
   limited to that stable chapter identity, ordered newest first, and shows each label, capture
   time, and source version. Duplicate labels remain distinguishable by their other displayed
   details.
2. **Given** an author opens a snapshot, **when** it is displayed, **then** the full saved body is
   readable as a read-only view, and the editor text and draft state are unchanged.
3. **Given** an author compares a snapshot, **when** the comparison opens, **then** it shows the
   snapshot and the current **saved** chapter body with changes clearly distinguished. If an editor
   draft exists, the interface says it is not part of this comparison; history does not flush or
   substitute that draft.
4. **Given** a snapshot's stored body or provenance fails validation, **when** the author lists,
   opens, or compares it, **then** the studio reports that snapshot as unavailable, leaves its data
   untouched for recovery, and does not change the chapter.

### Story 3 — Restore a snapshot without losing either version (Priority: P1)

The author reviews a named snapshot, sees what would change, and explicitly confirms a restoration.
Only the chapter body is restored; current chapter metadata remains as it is. The currently saved
body is kept as a visible safety snapshot before the write.

**Acceptance scenarios**

1. **Given** a valid snapshot belongs to the currently selected book and chapter, **when** the
   author chooses Restore, **then** the studio shows the selected label, the current saved body, the
   snapshot body, and the fact that the current saved body will be kept before continuing.
2. **Given** the editor has a pending draft, **when** the author attempts to restore, **then** the
   operation does not flush, discard, or replace the draft. The studio asks the author to save or
   discard it through the editor's normal controls first, or to cancel.
3. **Given** the author confirms and the chapter remains at the checked base version and hash,
   **when** the restore commits, **then** only the body is replaced, current front matter and
   chapter metadata remain intact, the previous saved body and selected snapshot remain recoverable,
   and the author sees an explicit success state.
4. **Given** another writer changes the chapter after the preview, **when** the checked write runs,
   **then** the normal version/hash conflict path wins: the newer file is not overwritten, the
   selected snapshot remains, the attempted restore text remains recoverable, and the author sees
   the conflict and a safe next action.
5. **Given** the author cancels before the first persistent write, **when** the dialog closes,
   **then** no chapter or history data changes. If the safety snapshot and prepared intent have
   already committed but the chapter write has not started, the chapter stays unchanged and both
   records remain visible as an unapplied restore. A chapter write already committed cannot be
   described as canceled; the studio reports its outcome and offers the restore-specific undo.

### Story 4 — Undo a restoration (Priority: P1)

After a successful restoration, the author can reverse that particular action without confusing it
with typing undo or an agent-turn undo.

**Acceptance scenarios**

1. **Given** a restore has committed, **when** the author chooses Undo restoration, **then** the
   previous saved body is written back through the same checked chapter writer, and the named
   snapshot used for the restore remains intact.
2. **Given** the chapter's saved version or hash changed after the restoration, **when** the author
   chooses Undo restoration, **then** the studio refuses to overwrite the newer text, retains all
   snapshots and drafts, and explains that the chapter changed since the restoration.
3. **Given** the restore-specific undo succeeds, **when** the author returns to the editor,
   **then** the committed result is shown explicitly and ordinary editor undo/redo and agent-turn
   checkpoint state are not silently consumed or rewritten.

## Functional requirements

- **FR-001 — Saved source:** A user-created snapshot MUST capture only a chapter body from a
  confirmed saved source. It MUST NOT capture unsaved editor text as if it were saved, trigger a
  draft flush, or be created from a pending, conflicted, or failed save.
- **FR-002 — Provenance and integrity:** Each snapshot MUST be bound to `bookId` and stable
  `chapterId`, and record the source chapter version, the source chapter's raw-file SHA-256 hash,
  and a SHA-256 hash of the stored body. Reads MUST verify identity and body integrity before
  offering open, compare, or restore. Source version/hash are provenance, not the base for a later
  restore.
- **FR-003 — Saved library data:** Snapshot content and metadata MUST be authoritative,
  author-owned library data, not an app-profile-only cache or opaque database. Writes MUST use the
  existing library service/storage boundary. D-175 resolves OQ-001's book-scoped layout and lifecycle;
  T001's format/ADR follow-through and T003's detailed validated schema precede persistence.
- **FR-004 — Explicit capture:** The author MUST explicitly supply a snapshot label and request
  capture. Ordinary chapter saves MUST NOT create snapshots automatically. Snapshot creation MUST
  leave the saved chapter file and editor draft unchanged.
- **FR-005 — List, open, compare:** The author MUST be able to list history for one chapter, open a
  snapshot read-only, and compare it with the current saved chapter body. These actions MUST NOT
  change the chapter, editor contents, save state, or draft buffer. A comparison MUST identify that
  it compares saved text, not a pending draft.
- **FR-006 — Body-only scope:** Restoring a snapshot MUST restore its body to the same book and
  chapter identity. It MUST NOT restore title, order, synopsis, role, front matter, or other chapter
  metadata. Current metadata MUST be preserved.
- **FR-007 — Checked restore:** Restore MUST use the current chapter's version and raw-file hash
  from the current checked read as `baseVersion` and `baseHash`, then use the existing checked
  chapter writer. It MUST NOT write chapter files directly, use the historical source version as
  the save base, or bypass atomic commit/conflict handling.
- **FR-008 — Preserve before restoring:** Before replacing the saved body, the studio MUST retain
  the current saved body as a visible, integrity-checked safety snapshot and persist a prepared
  restore intent that references the selected snapshot and checked base. If it cannot retain the
  body and intent, it MUST NOT start the chapter write. The selected snapshot and any committed
  safety snapshot MUST remain intact after success, cancellation, stale-base conflict, or failure.
- **FR-009 — Draft safety:** History browsing and comparison MUST never flush or consume an editor
  draft. Restore MUST require the editor draft to be resolved explicitly first. If new draft text
  appears during the operation, it MUST remain available and MUST NOT be silently replaced or
  flushed; the interface MUST mark it for normal conflict/reconciliation handling.
- **FR-010 — Restore-specific undo:** Each committed restore MUST create a recoverable,
  restore-specific undo that survives a reload. Before the chapter write, persist a prepared intent;
  after commit, finalize it with the exact post-restore version and hash. If finalization is
  interrupted, reconcile the intent against a checked chapter read before offering retry or undo;
  never replay the restore blindly. Undo MUST verify the exact post-restore version and hash and
  write the retained pre-restore body through the same checked chapter writer. If the base is stale,
  undo MUST refuse to overwrite and retain the undo material. A successful undo MUST NOT remove the
  named snapshots.
- **FR-011 — Honest cancellation and failure:** A cancel before the first persistent write MUST
  leave the chapter and history unchanged. If cancellation occurs after the safety snapshot but
  before the chapter write starts, the chapter MUST remain unchanged and the safety snapshot and
  prepared intent MUST remain visible and recoverable. A failed chapter write MUST leave the
  previous complete chapter intact. If commit succeeds but finalizing its undo record fails, the
  prepared intent MUST remain for reconciliation. The UI MUST report the actual commit outcome,
  never claim a committed write was canceled, and never retry a possibly committed write blindly.
- **FR-012 — Stale source:** A changed, missing, unreadable, or newer-schema chapter MUST not be
  replaced based on an old preview. The normal checked conflict path or a specific read error MUST
  leave all readable versions and pending drafts available and identify the next safe action.
- **FR-013 — Scope separation:** Chapter history MUST remain separate from editor undo/redo
  (002 FR-014), agent-turn checkpoints and their multi-chapter undo (002 FR-027), whole-library
  archive/restore (010), and sync drift/conflict review (016). It MUST NOT change those journeys or
  add an agent history tool.
- **FR-014 — Library lifecycle:** Snapshots MUST follow the stable chapter identity through title,
  filename, or order changes. Their storage and recovery MUST remain consistent with the chosen
  library format, archive, and existing recoverable-trash rules under accepted D-175.
- **FR-015 — Local privacy:** Snapshot text MUST stay in the author's library and MUST NOT be sent
  to a provider, included in agent context, logged, or uploaded by this feature. No network request
  or telemetry is introduced.
- **FR-016 — No automatic pruning:** Under accepted D-176, the feature MUST NOT automatically prune,
  expire, compact or impose a quota on snapshots, safety copies or intents. Explicit deletion moves
  records to recoverable chapter trash; size visibility comes from storage stats. Storage-capacity
  or write failure MUST be reported without deleting existing records. New numeric caps would need
  separate measured evidence and acceptance.

## Edge cases

- The chapter was renamed or reordered after the snapshot; stable IDs still identify it.
- A chapter with the same title exists in another book; identity prevents cross-book restore.
- The chapter was deleted to recoverable trash, is unreadable, or has a schema newer than the app.
- The history record is missing, malformed, or has a body hash that does not match.
- The selected snapshot was captured from an older version; that is expected history, not a stale
  restore base.
- Another process, agent turn, browser tab, or synced device changes the chapter after comparison.
- A draft is pending, starts while a restore is in flight, or a save result is delayed.
- The author cancels before commit, storage fills, permission is revoked, or the process stops after
  the safety snapshot but before chapter commit.
- A restore commits but its response is interrupted; the interface must check the saved result
  before offering retry.
- Many large snapshots consume library storage. No retention period or automatic cleanup is
  assumed by this spec.

## Non-goals

- Replacing the editor's local typing undo/redo or agent-turn checkpoint/undo.
- Automatically snapshotting every save or every agent edit.
- Restoring a whole book, chapter metadata, Story Bible data, images, or conversations.
- Syncing, merging, or resolving provider conflicts; snapshots do not establish which device is
  authoritative.
- Replacing or duplicating whole-library archive/import/export.
- Exposing history snapshots to agents or model providers.
- Automatic retention periods, quotas or pruning; D-176 rejects them for this scope.

## Resolved questions and remaining design work

The original local question IDs are retained for traceability. Their public decisions are accepted;
the post-submission implementation still needs the detailed format/schema and safety evidence.

| ID | Question | Accepted decision | Remaining work |
| --- | --- | --- | --- |
| OQ-001 | History layout, schema and archive/trash lifecycle | D-175: book-scoped `history/<chapterId>/` records with front matter and canonical bodies, loose schemas and newer-schema refusal; archive/whole-book trash carry them, chapter trash leaves stable-ID history available. | T001 format/ADR follow-through and T003 detailed fields/label grammar, then checked storage and lifecycle tests. |
| OQ-002 | Retention, size visibility and cleanup | D-176: no automatic pruning/quota/expiry/compaction, including unapplied intents; explicit recoverable deletion and stat-based size visibility. | T011 must implement the accepted policy and preserve restore dependencies. No new period or quota is implied. |

## Success criteria

- **SC-001:** In synthetic tests, every created snapshot can be reopened and verified against its
  book/chapter identity, source version/hash, and body hash; corruption never changes the chapter.
- **SC-002:** In synthetic tests, list/open/compare leaves saved chapter bytes and editor draft
  state unchanged.
- **SC-003:** In stale-base, cancellation, and injected-write-failure tests, the current complete
  chapter and all earlier snapshots remain recoverable, and no failed operation reports success.
- **SC-004:** A successful restore and its successful restore-specific undo use the checked writer,
  preserve the other version, and refuse stale bases in 100% of synthetic test runs.
- **SC-005:** No test or product path for this feature reads or writes a real manuscript, calls a
  live provider, accesses credentials, or introduces a network request.

## Assumptions

- The supported library targets use the shared checked library service/storage port defined by
  [010](../010-web-target/spec.md); renderer code does not gain filesystem access.
- “Saved chapter text” means the canonical Markdown body, not chapter front matter or metadata.
  The source hash is the raw chapter-file hash used by the current save protocol; the snapshot body
  has its own integrity hash.
- A restore preview is read-only. A restore only becomes an editor change after author confirmation
  and a confirmed checked commit; the editor is never replaced by a merely selected snapshot.
- Snapshot storage is author-owned data following D-175. ADR 0016 and the history section of
  `docs/FORMAT.md` define the detailed contract published with the first saved-only writer.
