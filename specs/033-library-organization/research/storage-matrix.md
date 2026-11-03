# Storage matrix for library organization data (Spec 033 T001, OD-033-01)

Research only. No behavior changes; no decision is accepted here. Evidence is
the repository's own storage code plus the premise tests in
`packages/core/tests/organization-storage-premises.test.ts` (book-scoped
sidecars travel with book trash/restore; a library-root metadata file rides
the archive but survives book trash) and the already-pinned primitives they
build on: `commitFile` expected-hash refusal (`library-port.test.ts`),
unknown-file archive round-trip (`archive.test.ts`), whole-book trash moves
(`service.deleteBook` via `moveDirectory`) and chapter trash/restore keeping
identity (`library-service.test.ts`).

## The checked-write primitive both options share

`LibraryPort.commitFile` with `{ kind: "sha256", value }` refuses a stale
base; `{ kind: "absent" }` refuses an existing file. Any new metadata write
must use one of these — never `{ kind: "any" }`. Note the negative precedent:
`updateBook` commits `book.json` with `{ kind: "any" }`, so concurrent book
edits are last-writer-wins. Planning/goal/annotation writes must not reuse
that path; the matrix below gives each contended type its own file and hash.

## Proposed matrix (D-166, awaiting author)

| Data | Scope | File | Durability | Archive / sync folder | Concurrency |
| --- | --- | --- | --- | --- | --- |
| Collections | Library | `collections.json` at library root | Author-owned ordinary file; validated, versioned, loose schema with spread round-trip; corrupt/unsupported-future refused, never reset | Rides the archive as a known author file (FORMAT names it); travels a synced folder like any file | Whole-file expected-hash commit; concurrent edits surface a conflict copy, never silent merge |
| Recent entries | Machine | Disposable host-profile preference (desktop `studio.json` in `userData`; web origin storage alongside the existing storage setting) | Disposable by design (FR-017 allows it): loss means an empty resume list, never data loss; write failure never blocks opening or saving (FR-008) | Does not travel; last-open times are resume state for this machine, and the spec makes no cross-device promise | No shared file, no conflicts by construction |
| Word goal | Book | `goals.json` beside `book.json` | Author-owned ordinary file; same validation/version/refusal rules; lazy creation on first set, no file for goalless books | Travels with book trash/restore (pinned premise) and the archive | Own expected-hash commit, disjoint from `book.json` edits — a goal save and a book-metadata save never false-conflict (unlike a `book.json` key under `updateBook`'s `kind: "any"`) |
| Annotations | Book | `annotations.json` beside `book.json` | Same file rules; records keyed by stable chapter identity; never written into chapter files (FR-014, FR-002) | Same travel as goals; chapter trash/restore keeps chapter identity so anchors survive it | Own expected-hash commit per book |

## Why not the alternatives

- **Goals as a `book.json` key.** Rejected: it would inherit `updateBook`'s
  unchecked whole-file write, so a goal save racing a description edit would
  silently last-write-win, and goal/body staleness checks would share one
  hash. A sidecar gives the checked write FR-012 requires.
- **Collections per book.** Rejected: membership spans books, so per-book
  fragments would need cross-file consistency with no primitive for it. One
  library-root file keeps membership atomic per commit.
- **Recent entries in the library.** Rejected as the default: resume times
  are machine-local, a shared recent file would conflict across devices for
  zero author benefit, and FR-008's non-blocking failure is trivially met
  when the library is never touched. Kept as the documented fallback if the
  author wants resume lists to follow synced folders.
- **Annotations inside chapter front matter.** Rejected: FR-014 requires
  annotation text separate from prose, and any chapter write must preserve
  the checked save/hash contract untouched.

## Explicitly not decided here

- OD-033-02 (D-167, Open): one-versus-many membership, name uniqueness,
  collection identity across rename, trash/restore reference handling.
- OD-033-03 (D-168, Open): serialized anchor representation and verification
  rule; needs the synthetic unchanged/edited/moved/repeated/missing passage
  matrix from the spec.
- Numeric caps (record counts, field sizes, file bytes): mechanism proposed
  (reject-before-write, no partial records, prior goal intact on failure);
  numbers stay with the author alongside D-165-style confirmation.
- `docs/FORMAT.md` gains the new files only when D-166 is accepted and
  implementation lands; the plan already requires the format update with the
  change, not before it.
