# Retention, size limits, and cleanup (032 T002, OQ-002)

Status: research, not accepted. This document records the retention facts and
a no-automatic-pruning recommendation for D-176. It sets no period, quota, or
pruning rule; OQ-002 forbids choosing one by assumption.

## Current behavior (pinned by premises)

- Chapter trash accumulates without pruning: deleting chapters leaves one file
  per chapter under `.studio/trash/<bookId>/`.
- Conflict copies accumulate without a cap: every kept version stays listed
  (`listConflicts` returns all of them).
- A failed expected-hash write preserves the existing bytes; nothing is
  deleted on the failure path.
- Pinned in `packages/core/tests/chapter-history-retention-premises.test.ts`
  (3 pass). No pruning pass exists anywhere in the library service; the only
  cleanup is failed-import staging removal (029 T009).
- Review reports are volatile and never persisted (034 T013), so retention
  policy only matters for persisted data — which history will be.
- The only numeric caps in the system are transport-scoped: the portable
  archive refuses more than 10,000 entries, 2 GiB total, or 512 MiB per file
  (`docs/FORMAT.md`). No storage quota exists on libraries, trash, conflicts,
  threads, or drafts.
- D-171 proposes a 20-per-book cap for saved review reports (Proposed, not
  implemented). It is a shape precedent for count caps, not an accepted rule
  this feature inherits.

## Alternatives considered

- **A. No automatic pruning; explicit author deletion to recoverable trash
  (recommended).** FR-016 forbids silent pruning and requires storage failures
  to report without deleting. The trash and conflict precedents are unbounded.
  History records are author versions; FR-008 and FR-011 require safety copies
  and restore material to remain recoverable, which automatic deletion would
  contradict.
- **B. A per-chapter snapshot count cap.** Rejected now: any number would be
  an assumption, and auto-deleting the oldest snapshot picks what the author
  loses. Revisit only with measured growth evidence and an accepted follow-on.
- **C. Age-based expiry.** Rejected: snapshots are meaningful precisely
  because they are old; expiry by date assumes a value judgment the spec does
  not make.
- **D. Library quota with automatic eviction.** Rejected: eviction silently
  chooses the author's loss and duplicates the transport caps' job at the
  wrong layer. Report-and-keep instead (FR-016).
- **E. Delete means unlink.** Rejected: permanent deletion contradicts the
  standing rule that nothing is deleted permanently without the author.
  Trash moves are same-volume renames, the same cost class as chapter delete.

## Recommendation detail

- No automatic deletion, pruning, quota, expiry, or compaction applies to
  named snapshots, safety copies, or restore intents — including unapplied
  intents, which are the recovery material FR-011 keeps visible.
- Author-initiated deletion moves the record file to
  `.studio/trash/<bookId>/` under the chapter-trash naming pattern. Restore is
  the existing manual move-back until the history UI offers it (T011).
- Quota, permission, and interrupted-write failures report the failure and
  keep every record; unapplied safety snapshots and intents remain for
  reconciliation. A chapter write already committed is never described as
  canceled.
- Size visibility comes from storage stats at list time, not from a new
  format field: per-snapshot bytes in the history list, book-level totals in
  the history entry point. Numeric caps, if ever needed, arrive with measured
  evidence and acceptance — not with this decision.

## What stays open

Numeric caps with evidence, the trash-retention policy for history records
(they inherit whatever chapter-trash policy exists — none today), and the UI
flows for deletion and its undo (T010/T011).
