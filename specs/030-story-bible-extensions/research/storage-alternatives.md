# Storage alternatives for Story Bible extensions (Spec 030 T001)

Research only. No behavior changes; no decision is accepted here. The comparison
uses the repository's own zod and storage code plus the premise tests in
`packages/core/tests/story-bible-storage-premises.test.ts` (unknown top-level
book fields survive a supported save; opening and reading a legacy book rewrites
nothing). D-163 proposes an option; the author accepts.

## What both options share

- Ordinary files under `books/<bookId>/`, written atomically through the
  `LibraryPort` expected-hash commit (`commitFile`/`commitText`). No hidden
  database; the format stays rebuildable from files (non-negotiable 1).
- Archive rides free: the portable archive includes every author-owned file,
  including unknown files (`docs/FORMAT.md`).
- Lazy, read-tolerant opens: a missing section or file projects empty extension
  data and never writes on open (FR-009, pinned for `book.json` by premise
  test 2; required by specification for a new file).
- The renderer never writes directly; saves go through `LibraryService` and
  the host API (FR-012).

## Option A — optional `planning` key inside `book.json`

- Unknown-field preservation comes free: `bookSchema` is a `z.looseObject`
  and `updateBook` spreads the parsed record, so unknown keys survive
  supported saves (pinned by premise test 1). A loose planning section would
  inherit this.
- Old books open unchanged: a missing key parses to the default (verified with
  the repo's zod: missing optional section is fine).
- Costs:
  - **Failure coupling (verified with the repo's zod):** if the planning
    section is validated as a nested strict object, one bad planning value
    fails the whole `bookSchema.parse`, and `parseBookJson` throws `format` —
    the entire book becomes unreadable because of one planning field. Avoiding
    that needs section-tolerant parsing (nested `safeParse` plus an issue
    record in the style of `chapterReadIssues`) specified up front.
  - **Conflict granularity:** planning saves rewrite the whole `book.json`,
    so a book-metadata edit and a planning edit from two writers conflict on
    the same file hash even when they touch disjoint sections. Per-record
    revisions (FR-003) would sit atop a whole-file commit (see D-164).
  - Every planning save rewrites the book file; every book save rewrites the
    planning bytes (harmless when preservation holds, but a bigger blast
    radius for Q2 semantics).

## Option B — separate versioned `planning.json` beside `book.json`

- In-repo precedent: `images.json` with `ImageStore` (D-130) — a separate
  versioned manifest, its own `schemaVersion` gate, newer versions refused
  (`newer-schema`), archived and exported with the book.
- **Must explicitly differ from `images.json` in two places:**
  1. The images schemas are default (stripping) zod objects, so unknown keys
     do not survive an images round-trip. The planning file must be specified
     `looseObject` with spread-on-write like `book.json` to meet FR-009 and
     FR-014.
  2. `readManifest` resets an unparseable manifest to an empty in-memory
     manifest, and the next `commitManifest` would clobber the on-disk bytes
     with it. The planning file must REFUSE writes while the on-disk shape is
     unsupported — never reset and never replace with empty data (FR-009,
     FR-014).
- Failure isolation: a corrupt `planning.json` never affects `book.json`
  readability; the book opens and the planning section reports unavailable.
- Conflict granularity: planning saves commit only `planning.json`, disjoint
  from book-metadata edits. Per-record revisions still need D-164 semantics,
  but on a smaller surface with no cross-section false conflicts.
- Costs: a new `docs/FORMAT.md` contract; an ownership check (the file must
  verify its `bookId` and refuse foreign identities, FR-004); lazy creation
  only on the first record and no-op saves that write nothing (FR-003,
  FR-009).

## Proposal (D-163, awaiting author)

Option B, under the conditions above: loose schema with spread round-trip,
newer-schema refusal, unparseable-shape write refusal, lazy creation, and
`bookId` ownership validation. The structural reasons are failure isolation
and conflict granularity; Option A's conveniences (one file, free
unknown-preservation) are replicable in B by specification, while B's
advantages are not replicable in A without section-tolerant book parsing plus
whole-file conflict semantics. The alternative stays open: if the author
prefers one file per book, Option A is viable only with a specified
section-tolerant parse and a Q2 answer for disjoint-section conflicts.

## Explicitly not decided here

- D-164 (Open): planning revision boundary, source snapshot, stale-draft and
  conflict representation, adapter conformance. It needs the D-163 outcome
  first, then a two-writer synthetic plus injected-failure suite against the
  chosen file.
- D-165 (Open): bounds, identity grammar/uniqueness and revision
  representation. The spec proposes limits; confirmation needs boundary
  fixtures against the accepted schema shape, so it follows D-163 as well.
