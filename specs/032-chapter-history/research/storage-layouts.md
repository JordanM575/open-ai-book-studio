# Storage layouts for chapter history (032 T001, OQ-001)

Status: research, not accepted. This document compares layouts and records a
recommendation for D-175. It authorizes no persistence code; T003+ still wait
on acceptance.

## What must hold

- FR-003: snapshot content and metadata are authoritative, author-owned library
  data. Writes use the existing library service/storage port.
- FR-002: each record binds `bookId` and stable `chapterId` and records source
  version, source raw-file hash, and a body hash. Reads verify before use.
- FR-014: records follow the stable chapter identity through title, filename,
  and order changes.
- FR-013: history stays separate from editor undo, agent-turn checkpoints,
  whole-library archive/restore, and sync drift review.
- The layout participates in the portable-archive and chapter trash/restore
  lifecycle; `docs/FORMAT.md` and the archive contract change only as the
  accepted decision requires.

## Verified facts the recommendation rests on

- A book is `books/<bookId>/{book.json, chapters/, conflicts/, images.json,
  images/, threads/, checkpoints/}`; `.studio/` holds device, sync, staging,
  and trash state (`packages/core/src/library/paths.ts`, `docs/FORMAT.md`).
- `checkpoints/` is created by `ensureBookLayout` but nothing writes there;
  FORMAT reserves it for draft checkpoints. Agent checkpoints are thread-turn
  state (`checkpointTurns`), owned by the open D-113 — not this feature.
- `locateChapter` resolves chapters by stable front-matter `id`, scanning every
  `.md` file. Title edits rewrite the same file; filenames are order-slug
  cosmetics (`slugify` is documented "never used for identity").
- Whole-book trash is a whole-folder `moveDirectory` (everything rides);
  chapter trash is a single-file `moveFile` (siblings stay). There is no
  trash-restore operation in the product; restore is a manual move back.
- The portable archive (D-112, accepted) includes every author-owned file
  including unknown files, and excludes `library.json` and `.studio/` except
  `.studio/trash/`. Import validates manifest, paths, counts, sizes, and
  format/schema versions before publishing.
- Single-file writes commit atomically through the expected-hash path
  (`commitText`); the staging plus whole-directory-move pattern (029 T009)
  exists for multi-file publication and is not needed per record.
- The in-memory port proves create-unconditional plus update-only-on-hash-match
  (`packages/core/tests/chapter-history-storage-premises.test.ts`, 5 pass).

## Alternatives considered

- **A. Book-scoped `history/` beside `chapters/` (recommended).**
  `books/<bookId>/history/<chapterId>/<timestamp>-<label-slug>[-n].md`, one
  file per record, YAML front matter plus canonical body — the same shape as a
  chapter file. Rides whole-book trash/restore and the archive by construction;
  chapter trash leaves it in place, still keyed by stable id.
- **B. `.studio/history/`.** Rejected: `.studio/` (except trash) is excluded
  from portable archives and carries device-local semantics (sync journals are
  never exported). History is author data, not device state (FR-003).
- **C. Reuse `checkpoints/`.** Rejected: FORMAT reserves that directory for
  draft checkpoints, D-113 owns its meaning (patch versus snapshot is
  unresolved), and agent-turn scope differs (FR-013).
- **D. One `history.json` per book.** Rejected: a single corrupt file bricks
  every snapshot (the failure-isolation rationale behind D-163's separate
  `planning.json`), every capture rewrites the whole file, and concurrent
  writers collide at file granularity instead of record granularity.
- **E. JSON sidecar plus raw body file per snapshot.** Rejected: two files per
  record need creation ordering and crash-orphan handling; front matter carries
  the same provenance inside the single atomic write readers already parse.
- **F. History appended inside chapter files.** Rejected: every snapshot would
  rewrite chapter bytes (FR-004 requires creation to leave the saved file
  unchanged) and would pollute the version/hash save protocol.

## Recommended record shape (schema detail stays with T003)

Front matter carries `schemaVersion: 1`, `kind` (`snapshot`, `safety`, or
`intent`), `bookId`, `chapterId`, `label` for named records, `sourceVersion`,
`sourceHash`, `bodyHash`, and `capturedAt`. Intent records add the selected
snapshot reference, the checked restore base, and the prepared/finalized
state, and carry no body. The body is the canonical saved Markdown body for
snapshots and safety copies.

Schemas stay loose with spread round-trips (the D-163/D-166 pattern, unlike
`images.json`, which strips unknown keys). Newer-schema records refuse at read
instead of resetting to empty (the `assertSchemaVersion` precedent). Snapshot
filenames use `<timestamp>-<slug>[-n].md`, reusing `slugify` for the readable
part and the trash code's numeric-suffix loop for collisions; only the stable
`chapterId` directory and the front-matter identity are load-bearing.

## Lifecycle participation

- **Archive:** history files travel as ordinary author-owned files, including
  unknown future keys. Import schema gates apply before publication; records
  with a newer schema refuse at read like `book.json`.
- **Whole-book trash:** the `history/` directory rides the folder move and
  restores with it. FORMAT's "keeps book.json, chapters, conflicts and
  checkpoints" extends to history without a doc change at decision time; the
  T003 implementation updates FORMAT alongside the code.
- **Chapter trash:** history stays under `books/<bookId>/history/` while the
  chapter file sits in `.studio/trash/<bookId>/`. A manual chapter restore
  re-links by stable id; nothing depends on a trash-restore UI that does not
  exist.
- **Snapshot deletion:** author-initiated deletion moves the record file to
  `.studio/trash/<bookId>/` under the chapter-trash naming pattern, honoring
  the standing rule that nothing is deleted permanently without the author.
  The T011 UI offers this; no silent or permanent delete path is added.
- **Sync:** journals baseline each author-owned file automatically, so history
  files drift-detect like chapters. How they display is owned by 016/D-123;
  this feature adds no merge semantics, consistent with the studio's
  no-merge rule.
- **Scope separation:** editor undo, agent threads and checkpoints, archive
  journeys, and drift review are untouched; history adds no agent tool.

## What stays open for T003 and later

Field-level schema and label grammar/limits (the D-165 bounds pattern),
intent-state machine detail, whether intents appear in the browse list or only
in restore status, and per-snapshot size display.
