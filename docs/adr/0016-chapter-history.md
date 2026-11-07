# ADR 0016: Saved-text chapter history

**Status:** Accepted, 2026-11-07, under the author's delegated implementation authority.
**Scope:** Spec 032 T001/T003/T004 and bounded T007–T009 core; implements accepted D-175/D-176.

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
   result version/hash for applied/undone states. W01 reserves this data contract; the W02
   core below adds persistence, reconciliation, restore and undo. Unknown fields, including nested
  reference/result fields, survive codec round-trips within the supported value domain below. Unsupported/corrupt records
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
- Use the existing book lock, checked commit and sync-journal hooks. Saved-only operations do not
  flush drafts, save chapters or rebuild catalogs. The restore core below adds no IPC/UI/agent entry point.

## Consequences

### Bounded restore/undo core, November 7

Accepted under delegated implementation authority before W02 persistence: add optional loose
`plannedResult: { version, hash }` and `plannedUndoResult: { version, hash }` to intents. Each
is computed from the **complete exact serialized next chapter file**, including current metadata,
incremented version and fixed update time, before its respective chapter write. A body hash alone
cannot distinguish an interrupted restore from an unrelated writer's similar text. Existing records
without these fields remain readable; prepared legacy intents cannot establish a committed result.
No chapter operation marker or additional metadata is introduced. These hashes prove byte identity,
not authorship; recovery reports a matching result, never who wrote it.

Restore and undo run within the existing book queue, use its journal-aware checked chapter writer,
and exact-check version **and** raw hash even for equal bodies. They increment the version for equal
bodies as well. Preserve current raw metadata values (including names shared with runtime Chapter
properties), changing only body plus the normal version/update-time bookkeeping. Safety and prepared
intent publication must be verified before replacement. Intent transitions use expected raw hashes;
conflict or uncertainty keeps all recovery material. Undo first durably prepares its exact result in
the same intent. Read-only reconciliation compares complete identities without replay or mutation;
an interrupted undo is not retried automatically. Host draft/save gating and confirmation remain
required before these APIs can become author-facing.
History skips the ordinary post-save disposable catalog rebuild, which scans unrelated chapters
through the legacy diagnostic parser. It returns the committed chapter directly; the catalog is
never read as truth. This keeps successful restore/undo on the same quiet boundary as capture.

The raw persisted envelope and the successful runtime `Chapter` are distinct: supported partial
front matter retains its omitted fields on disk, while the returned view combines its checked saved
fallbacks with validated new metadata. Serialization never inserts the runtime projection merely
to satisfy the success type. This applies equally to restore and restore-specific undo.

### Codec review correction, November 7

The first codec accepted YAML-native Set/Date values and a reserved key that its serializer/schema
could not preserve. Under delegated repair authority, accept only plain string-keyed mappings,
dense arrays, strings, booleans, null and finite numbers; integer numbers must be safe integers,
negative zero is unsupported, and parsed numeric tokens must retain their mathematical decimal
value after serialization. Reject `__proto__` at every depth, complex mapping keys, unsupported
tags, cyclic references, accessors, foreign objects and non-data properties before schema parsing
can erase them. Ordinary nested unknown data and acyclic aliases retain their values; YAML spelling,
comments, anchors and graph identity are not the value-preservation contract. Unsupported records
stay byte-intact and unavailable, not normalized into another type.

History's entire source-resolution path uses this quiet parser and fatal UTF-8 decoding, including
chapter candidates inspected while resolving identity. It validates raw hashes and reports fixed
errors without parser excerpts or warning emissions. Ordinary legacy chapter reading keeps its
existing compatibility behavior; history never invokes that warning-emitting parser first.

For filesystem-backed history lists, an optional metadata-only directory inspection primitive
reports unsupported entry names without following them. History lists these as unavailable;
ordinary directory listing and archive traversal continue to exclude them. Hosts whose storage
can contain only ordinary files/directories use the existing listing. This keeps a linked history
record from silently vanishing from the history UI while preserving the adapter's refusal policy.

Snapshots remain ordinary recovery material across archives and trash. Integrity detects
accidental body changes, not authenticated provenance: an author can edit these files.
Headerless chapters must first be saved normally to gain stable identity. Existing archive
transport caps remain transport-only; future/corrupt history bytes can travel unchanged and
are refused on history read. Deletion dependency policy, UI and end-to-end draft
gating remain separate tasks. See [FORMAT](../FORMAT.md#chapter-history).

The existing filesystem port's expectation-check/write/readback sequence is not cross-process
compare-and-swap. Absent-only requests and byte verification preserve the existing boundary,
not external-writer exclusion. A mismatched readback or exception after possible publication
reports an unconfirmed write, retains any complete record and directs review before retry;
the core neither automatically retries that outcome nor removes its file.
