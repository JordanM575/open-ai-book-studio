# Research: ordered matter schema and legacy conversion (D-169)

**Task:** 035 T007 · **Status:** research recorded, decision not accepted — nothing is migrated here.
**Evidence:** `packages/core/tests/matter-schema-premises.test.ts` (4 pass, in-memory library port);
`packages/core/src/schema.ts` (`frontMatter: z.record(z.string(), z.string())`);
`packages/core/src/library/service.ts` (`updateBook` spread-merge, `parseBookJson` strict parse).
No live provider, paid service or author manuscript was used. 003 FR-010 is the source of
populated legacy records (subtitle, author name, dedication, disclaimer, about the author).

## Current shape (observed)

- `frontMatter` is a free-form `record<string, string>` on the book, described as "title page,
  dedication, acknowledgements, author's note". There is no kind, no order field and no
  rendering: `buildDocx` ignores it (T006 baseline).
- `updateBook` spreads the patch over the current book and re-parses: a `frontMatter` patch
  **replaces the whole record**. Omitted keys do not merge back (premise test). Any conversion
  UI must therefore always write the complete record.
- Unknown string keys survive supported saves in insertion order, through both the file bytes
  and `readBook` (premise test). Key order is the only ordering information that exists today.
- The schema parses strictly on open: a single non-string value anywhere in `frontMatter`
  rejects the whole book with a `format` error (premise test). A legacy record that is not a
  flat string map bricks the book — it does not degrade, and no repair path exists yet.
- A patch the schema cannot parse rejects before any write; the file stays byte-identical
  (premise test). Bad data fails closed on write but fails open on read: today's write path
  can never *create* the unreadable state, only a hand-edited or foreign-written `book.json`
  can.
- Book-level saves commit with `kind: "any"`: last writer wins, no conflict copy. Matter
  edits share that semantic until a decision says otherwise.

## Classification proposal

Kind is a pure function of the key at render time; nothing stored, nothing to migrate:

| Key (case-insensitive) | Kind |
| --- | --- |
| `title`, `subtitle`, `author` | title-page |
| `dedication` | dedication |
| `epigraph` | epigraph |
| `acknowledgements`, `acknowledgment` | acknowledgements |
| `authorNote`, `note` | author-note |
| `disclaimer` | disclaimer |
| `aboutAuthor`, `about the author` | about-author |
| anything else | unplaced (preserved verbatim) |

Unknown keys are never renamed, deleted or reinterpreted. They render after known matter in
record order under a neutral treatment until the author classifies them.

## Ordering proposal

Additive `matterOrder: string[]` on the book (default `[]`), listing `frontMatter` keys in
display order. Empty means the fallback: known kinds in the table order above, then unplaced
keys in record order. Rationale: authorial order (dedication before or after epigraph) cannot
be derived from kinds, but a fixed fallback keeps unconverted books deterministic. The field
is order-only: it never adds, removes or renames record keys, so clearing it is the rollback.

## Preservation and rollback proposal

- Conversion writes `matterOrder` only. The `frontMatter` record is never renamed, deleted or
  reshaped by conversion — that is the preserved original.
- Rollback is clearing `matterOrder` (restores the deterministic fallback) — no backup file,
  no second record, nothing the format document must then explain.
- Matter-order edits share `book.json`'s existing last-writer-wins save semantic; no new
  conflict machinery is proposed. The conversion UI (T010) shows the proposed placements and
  requires explicit confirmation before saving, and it always writes the complete record
  (whole-record replace makes partial writes lossy by construction).
- Unreadable records (non-string values): propose tolerant carry — parse `frontMatter` as
  `record<string, unknown>`, preserve unparseable values verbatim through supported saves,
  surface a review issue naming the keys, and render/edit string values only. Strict parsing
  stays for writes the studio itself makes. The alternative — keep bricking the book until an
  explicit repair UI exists — leaves 003-imported books at risk and is not recommended.

## What this unblocks when accepted

T009 (additive versioned parsing + round-trip tests + `FORMAT.md`), T010 (author-reviewed
conversion UI exactly as decided). Renderer selection (D-108) can then consume ordered matter
for DOCX/PDF/EPUB placement. Nothing here migrates or reinterprets an existing record.

## Recommendation

Accept the kind table, the additive `matterOrder` field with the fixed fallback, order-only
conversion with explicit confirmation, clear-to-rollback, and tolerant carry for unreadable
records. The alternatives from the spec — purely manual placement, or preserving everything
as unconverted data with no ordering story — either scale poorly to 003 imports or leave the
readability hazard in place.
