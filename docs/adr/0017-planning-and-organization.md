# ADR 0017: checked planning and organization records

**Status:** Accepted, 2026-11-07, under the author's delegated feature-delivery authority.
**Decisions:** D-163–D-168. **Specs:** 030 and 033. Implementation and acceptance remain separate.

## Context and alternatives

D-190 already preserves unknown nested book fields and provides checked three-way book edits.
`updateBook` also checks its fresh read at commit; older claims that every book update is unchecked
are obsolete. A tolerant section in `book.json` is feasible. We choose separate planning and
organization files for independent validation and their explicit all-or-stale save contract, not
because book metadata necessarily loses fields. One file per record would make ordering and
membership multi-file transactions; the storage port provides no such transaction. A profile or
derived index cannot own authored planning, collections or notes.

## Accepted storage and identity

| Record | Location and ownership | Lifecycle |
| --- | --- | --- |
| Planning | Optional `books/<bookId>/planning.json`, schemaVersion 1, bookId and file revision | Worldbuilding/timeline/beat lists and optional singleton story notes; explicit ordered ID lists for timeline/beats; records archive/restore in place |
| Collections | Optional library-root `collections.json`, schemaVersion 1 and file revision | Stable collection records and member book-ID sets; explicit reversible archive/restore, no book moves |
| Goal | Optional `books/<bookId>/goals.json`, schemaVersion 1, bookId and revision | One positive-safe-integer targetWords or null; clear writes null without deleting unknown data |
| Annotations | Optional `books/<bookId>/annotations.json`, schemaVersion 1, bookId and revision | Stable note/bookmark records with exact saved-source anchors and reversible archive state |
| Recent work | Disposable host preference for the current selected library only | ID/timestamp pointers from successful explicit navigation, not authored library data |

Author-owned files travel in ordinary folder copies and portable archives. Whole-book trash carries
its sidecars. Root collections remain when a member book is trashed. Missing optional files mean
empty state without writes; first meaningful changes create them. Malformed, over-budget,
foreign-owner or newer-schema files are unavailable and write-refused, never reset to empty.
Supported unknown fields survive at every level. Known invalid record shapes are not discarded.

New IDs are host-generated and immutable: `wb_`, `tl_`, `sn_`, `beat_`, `ann_`, `col_` with
`[A-Za-z0-9-]{6,40}` suffixes. Existing book/chapter IDs retain their compatibility grammar. Every
book-owned record and actual `book.json` ID must match the requested book; a path or successful
parse alone does not establish ownership. Retained active/archived IDs are unique.

## One checked mutation, no implicit merge

1. Read tokens are either `{kind: "absent", revision: 0}` or a raw-file SHA-256 plus file revision.
   Persisted file/record revisions start at 1, use safe integers and refuse overflow.
2. Validate the owning book, supported schemas, exact token and allowed edit under the existing
   book queue (a library-level queue for root collections). New writes use absent expectation;
   edits use the exact hash. Missing-after-read is stale, not permission to recreate.
3. Construct changes from the verified baseline plus validated intent. Preserve unknown/unrelated
   values and immutable ownership/kinds. Increment file revision once; only content/archive edits
   increment an affected record revision. Reordering changes the file's ID order, not chapter order
   or unrelated record revisions. A verified semantic no-op writes nothing, including journals.
4. Make one checked commit attempt. Stale requests, including same-content stale requests, do not
   merge, rebase or retry against new bytes. The newer active document stays intact.
5. Preserve a stale draft as a complete parseable JSON document in the book's `conflicts/`, or root
   `conflicts/` for collections. Names are collision-safe, absent-created and byte-verified. A
   copy-only `conflictMetadata` records baseline/reason; active documents never inherit it silently.
   Only a verified durable copy may be described as kept. Failed preservation leaves a dirty form
   with an explicit warning, not a false Saved state; book-schema guards are not bypassed.
6. Pending results belong to their originating book/view. Keep editing retains the original draft
   and baseline. Reload/discard is explicit. Reopening inspects actual storage and never replays an
   uncertain request automatically. These checks do not claim cross-process filesystem CAS.

## Bounds

- Planning: at most 200 retained records per worldbuilding/timeline/beat list, including archived,
  and one optional story-notes record. Short fields: 200 UTF-16 code units; prose fields: 20,000.
- All authored planning/organization sidecars: **2,500,000 UTF-8 bytes of exact serialized output**,
  including unknown fields, ID arrays, indentation and newline. Enforce both input and output bounds;
  stat is an early check, not a substitute for actual read length. Reject the entire over-limit edit
  with the draft preserved; never truncate or remove unknown fields to fit.
- Collections, membership and annotations have no extra arbitrary count quota; their total byte
  budget bounds size. Notes and excerpts use the 20,000-unit limit. Page/window long lists.
- A request may carry one bounded baseline and one bounded draft plus a strictly validated control
  envelope. Bound each document independently; a recovery envelope is at most 5,000,000 bytes and
  must retain a full allowed draft. No unbounded extra copies or arbitrary control fields.
- No automatic pruning of authored records. The per-field/count maxima intersect with the total
  byte limit; the UI must not promise that every maximum-size record fits simultaneously.

The byte budget follows the current authored-metadata scale while fixing its ambiguous character
unit. Synthetic serialization measured 729,613 bytes for 600 substantial planning records plus
notes, 24,397,173 bytes at maximum ASCII field sizes, and 145,697,173 with maximally escaped text.
Those measurements justify an aggregate bound; they do not certify maximum-workload UI performance.

## Collections, recents and goals

Collections allow many-to-many stable book-ID membership. Names retain trimmed display spelling;
active uniqueness keys are NFC then locale-independent lowercase, without accent stripping or
linguistic case-fold promises. Restore into an occupied name requires explicit rename-and-restore.
Sets reject duplicate IDs and serialize deterministically. Add-present/remove-absent are no-write
successes only against a valid current baseline. Missing/trashed/ambiguous members stay unavailable;
same-title replacements never substitute for an ID. Removing a collection moves no book.

Recents consume a one-use explicit-navigation intent only after the intended book opens successfully
and remains the current view. Listing, refresh, import, onboarding, review and background reads do
not count. Keep one pointer per book in serialized successful-open order; timestamps are display
data. Desktop scope is the normalized selected library root; web OPFS uses its library ID and a
selected folder uses a persisted opaque token with its handle, never the handle's display name.
Changing selection starts a fresh list; reopening the same saved selection retains it. A 2,500,000-byte
pointer budget may evict oldest disposable pointers, never authored records. Update intents inside
the host settings queue; failures do not block book use, and unrelated settings writes preserve a
malformed/newer recent section until an explicit reset of that disposable section.

Goal progress uses the shared counter on a complete verified saved chapter set, not a partial
`BookSummary.wordCount` or draft. Return complete/incomplete/unavailable distinctly; unreadable
chapters cannot produce a confirmed whole-book percentage. Recheck identity/version/hash/enumeration
before confirming a count. Dirty or pending work shows last-confirmed saved progress. Zero chapters
is a complete zero. Target values are positive safe integers; clear is null and failures preserve
the previous target. No daily quota, activity history or productivity ranking is added.

## Exact annotation anchors

Use `{kind: "saved-body-span", bookId, chapterId, chapterVersion, chapterHash, startOffset,
endOffset, excerpt}`. Offsets are half-open UTF-16 code units in the canonical saved body, matching
the existing review/editor convention. Require a nonempty span, integer bounds, no split surrogate
pair and exact excerpt equality. This replaces the older line-only proposal: it must not widen a
partial-line selection. Human-readable lines are derived, not authoritative.

Create/re-anchor requires a clean confirmed saved source and independent service verification.
Navigation verifies exact identity/version/raw-file hash, bounds/excerpt, then the destination
editor's matching clean source before selection. Any failed check keeps the note/excerpt visibly
stale or unavailable and selects nothing. No normalization, fuzzy search, title match or silent
re-anchor. Note-only edits preserve even stale anchors. A source change after successful annotation
commit means saved-but-stale, not an unsaved note. Chapter retitle/reorder or raw line-ending changes
stale an anchor when its version/hash changes; unchanged-byte identity-preserving moves can revalidate.

## Required evidence

### Numeric and saved-source review follow-through

Before parsing a mutable sidecar, compare each unquoted JSON number token with the exact decimal
value that its JavaScript Number will serialize. Refuse non-finite, rounded, underflowed or negative-zero
tokens instead of rewriting them, including inside unknown values and recovery baselines. Numeric
strings are data and remain untouched. Known identity/revision/target fields retain their stricter
safe-integer rules. This is an admission boundary, not a migration or retention policy.

Goal progress independently checks the raw bytes and hash of every enumerated chapter, uses fatal
UTF-8 decoding, and verifies the canonical saved body and recorded identity/version against the
supplied chapter view. A repeated but lossy or unverified BookDetail is insufficient for a confirmed
count. The host still owns complete enumeration and the existing shared queue; these checks add no
second writer or general legacy-file migration.

The research's 49 synthetic premise tests are not the unbuilt feature tests. Implementation needs
real new-service round trips, exact no-op/stale/collision/unknown-field/owner/byte-boundary cases,
failed copy publication and uncertain readback, archive/trash preservation, complete/partial goals,
navigation-intent scope and exact Unicode/repeated-passage anchor tests. UI/IPC integration and
cross-adapter conformance remain separately checked delivery slices. No new provider or agent
authority is granted by manual planning and organization.
