# ADR 0016: Saved-text chapter history

**Status:** Accepted, 2026-11-07, under the author's delegated implementation authority.
**Scope:** Spec 032 T001/T003/T004; implements accepted D-175/D-176.

## Context and evidence

D-175's [layout research](../../specs/032-chapter-history/research/storage-layouts.md)
compares six storage choices. `LibraryService` already serializes book writes and the
storage port supports absent-only atomic publication. Archive transport includes unknown
book files; whole-book trash moves the tree and chapter trash moves only its chapter.
The current chapter parser supplies fallback IDs for headerless files; those IDs depend
on filenames, so history must require a persisted chapter ID before capture.

The implementation consulted the current [Zod API](https://zod.dev/api) and
[yaml 2 API](https://eemeli.org/yaml/) on 2026-11-07 (Context7 was quota-unavailable).
Loose objects preserve unknown keys; strict request objects reject caller-supplied prose.
YAML document parsing permits errors/warnings to be inspected without logging author text.

## Accepted recommendations

- Keep independent YAML-front-matter Markdown records in
  `books/<bookId>/history/<chapterId>/<timestamp>-<label-slug>[-n].md`.
  Each has a generated `hist_…` ID independent of its filename. Use the existing slug
  algorithm (60-character hint) and absent-only commits with numeric collision suffixes.
  Never request replacement of an existing record, including a malformed one. A bounded collision
  retry is an operation failure, never a retention limit.
- Labels are nonblank single-line strings, trimmed only at explicit capture, at most
  200 Unicode code points. Reject control characters rather than silently truncate.
  This matches the existing conversation title scale while keeping names portable;
  label text is never a path. IDs follow existing prefix plus six-or-more alphanumeric/
  hyphen grammar. Hashes are lowercase 64-digit SHA-256. Versions are nonnegative safe
  integers, matching existing chapter version zero support. Times are UTC ISO strings
  with milliseconds for stable ordering and filenames.
- Validate loose metadata for `snapshot`, `safety`, and bodyless `intent` records.
  Intents describe `prepared`, `applied`, or `undone` state, with selected/safety
  references (filename, record ID, raw-file hash), intended body hash, and exact
  result version/hash for applied/undone states. This is a data contract only; W02
  owns persistence, reconciliation, restore and undo. Unknown fields, including nested
  reference/result fields, survive codec round-trips. Unsupported/corrupt records
  remain untouched and are reported individually rather than becoming an empty list.
- Require a caller's confirmed `saved` state plus exact source version/hash; read the
  body from storage, never accept prose in the capture request. Require persisted
  chapter identity and reject future chapter schema. The host must gate this request
  against its real draft/save state; a core request cannot independently observe a UI.
  History has no draft buffer or flush capability. A source changed before the final
  prepublication read is refused. A change after that read cannot corrupt the immutable
  captured source; this is not a cross-file transaction or a claim of latest text.
- Open/list remain available by stable identity while a chapter is trashed. Compare
  requires a readable current saved chapter and returns both bodies, source provenance,
  and equality; presentation of changes belongs to W02. Lists include per-file
  unavailable states and stat-derived size, newest valid records first with deterministic
  filename ties. No body/count quota, pruning, expiry, compaction or deletion API.
- Use the existing book lock, checked commit and sync-journal hooks. Do not flush
  drafts, save chapters, rebuild catalogs, or add an IPC/UI/agent entry point.

## Consequences

Snapshots remain ordinary recovery material across archives and trash. Integrity detects
accidental body changes, not authenticated provenance: an author can edit these files.
Headerless chapters must first be saved normally to gain stable identity. Existing archive
transport caps remain transport-only; future/corrupt history bytes can travel unchanged and
are refused on history read. Restore, deletion dependency policy, UI and end-to-end draft
gating remain separate tasks. See [FORMAT](../FORMAT.md#chapter-history).

The existing filesystem port's expectation-check/write/readback sequence is not cross-process
compare-and-swap. Absent-only requests and byte verification preserve the existing boundary,
not external-writer exclusion. A mismatched readback or exception after possible publication
reports an unconfirmed write, retains any complete record and directs review before retry;
the core neither automatically retries that outcome nor removes its file.
