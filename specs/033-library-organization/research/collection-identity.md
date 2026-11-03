# Collection identity and membership (Spec 033 T002, OD-033-02)

Research only. No behavior changes; no decision is accepted here. Evidence is
the repository's identity primitives plus the premise tests in
`packages/core/tests/collection-identity-premises.test.ts` (rename preserves
id and chapter paths; trashed ids are unresolvable and never substituted by a
same-title book; restore keeps id and chapters).

## What already exists

- **Book identity is the stable directory id** (`book_<rand>`). A title rename
  (`updateBook`) rewrites only `book.json` in place — the directory, chapter
  paths and chapter ids do not move (pinned). Collection references must use
  this id, never title or path: titles are editable and paths are layout.
- **Trash removes resolvability.** `deleteBook` moves the whole directory to
  `.studio/trash/books/<stamp>-<bookId>/`, so `readBook(oldId)` throws
  `not-found` (pinned). A collection entry pointing at a trashed id therefore
  dangles by construction — the "unavailable entry" UI state falls out of a
  plain id lookup, with no extra tombstone needed.
- **Restore returns the identity.** Moving the directory back restores the id,
  title, chapters and sidecars (pinned). A restored book revalidates existing
  references automatically.
- **Same title never substitutes.** New books get fresh random ids, so a new
  book titled like a trashed one never equals the old id (pinned). Identity
  comparison is string equality on the id; title matching must never be used
  as a fallback.

## Proposal (D-167, awaiting author)

- **Membership is many-to-many.** A book may belong to several collections;
  a collection holds an id-keyed membership set. Rationale: collections are
  groupings, not folders — exclusive membership would force arbitrary
  single-bucket choices and add a cross-collection uniqueness invariant with
  no stated author benefit. The rejected alternative (one collection per book,
  shelf model) is documented here so the author can still choose it.
- **Names are unique (case-insensitive).** Creating or renaming to an existing
  name (compared case-insensitively after trimming) is refused before any
  write. Rationale: collections are addressed by name in lists and dialogs;
  near-duplicate names ("Sci-Fi" vs "sci-fi") would confuse. Whitespace-only
  names are refused as empty.
- **Identity is a stable `col_` id, assigned at creation, surviving renames.**
  Rename changes only the name. Note as an implementation consequence: the
  current `idSchema` accepts only `book|ch|char|mem|thread|cp` prefixes, so
  collection (and later goal/annotation) identities need a schema extension
  when T004/T005 land — no silent reuse of book ids.
- **Add/remove are idempotent no-ops on success.** Adding a present member
  changes nothing and reports success; removing an absent member likewise.
  Rationale: retries, double-clicks and replayed intents are safe, matching
  the spec's cancel/no-side-effect ethos. A no-op membership write rewrites
  nothing (same principle as FR-003's no-op saves).
- **Trash/restore handling falls out of id refs.** Trashed members show as
  unavailable (lookup fails); they are never offered as destinations and
  never substituted. Restoring the same id revalidates them with no repair
  step. A different book with the same title never matches.

## Explicitly not decided here

- Numeric caps on collection counts, name lengths and membership sizes stay
  with the author (same bucket as D-166's caps).
- Whether the collections file sorts members, and how the UI orders
  collections, is presentation for T005, not identity.
