# Source-anchor representation and verification (Spec 033 T003, OD-033-03)

Research only. No behavior changes; no decision is accepted here. Evidence is
the repository's save protocol and chapter model plus the premise tests in
`packages/core/tests/annotation-anchor-premises.test.ts` (any real edit
advances version and hash; identical re-saves touch neither; body lines
extract deterministically; trashed chapters are unresolvable).

## What the anchor can rely on

- **Content-addressable saved state.** Every real save advances the chapter
  version and changes the whole-file SHA-256 (front matter carries version
  and timestamps, so even whitespace-only edits change the hash). An
  identical re-save is a no-op that keeps both. The pair
  `(chapterId, version, hash)` therefore names exact saved bytes: a mismatch
  unambiguously means "changed", never "maybe changed".
- **Normalized body lines.** `normalizeBody` folds CRLF/CR to LF and trims
  edge blank lines at every save, so the recorded range is over canonical
  body lines — line-ending-only edits cannot shift anchors, and trailing
  blank-line churn does not exist in saved text.
- **Line coordinates already exist.** Agent tools address chapter prose by
  1-based body lines (`find_in_chapter` returns line numbers; insert/replace
  take them). Anchors in the same coordinates stay consistent with tooling
  the author may already see.
- **Unresolvable means stale.** A trashed chapter fails lookup; an
  unreadable one surfaces through chapter-read issues. Both are "cannot
  verify", never "guess".

## Proposed serialization (D-168, awaiting author)

An anchor record carries: `bookId`, `chapterId`, `chapterVersion`,
`chapterHash` (whole-file SHA-256 at anchor time), `startLine`/`endLine`
(1-based, inclusive, over normalized body lines) and the verbatim `excerpt`
of those lines. Creating or re-anchoring requires a confirmed saved source:
the range is taken from the chapter read, and its `version`/`hash` are stored
with it.

## Proposed verification rule (D-168, awaiting author)

Open if and only if ALL hold, checked in order:

1. The book resolves and the chapter id resolves to a readable chapter
   (otherwise stale: missing/unreadable).
2. The chapter's current `version` AND `hash` equal the anchored pair
   (otherwise stale: edited — even slightly, even moved within the file,
   since any byte change alters the hash).
3. The current body lines `startLine..endLine` join to exactly the stored
   excerpt (otherwise stale: range shifted — e.g. lines inserted above).

Any failure marks the bookmark visibly stale, retains the saved excerpt and
note, and selects nothing. There is deliberately NO fuzzy fallback: no
nearest-match, no search-elsewhere, no excerpt search across chapters, no
ignoring the version check when the text "looks the same". FR-015 forbids
guessing, and the hash makes guessing unnecessary — exact verification is
cheap and total.

## Deliberately deferred to T008 implementation

- Whether `endLine` is inclusive and how zero-length (point) anchors
  serialize, if points are allowed at all.
- Re-anchor UX wording (the explicit-confirm requirement is already fixed).
- Anchor migration if chapter files ever change shape (out of scope now).

## Explicitly rejected

- **Passage-hash-only anchors** (hash the excerpt, skip the chapter
  version/hash): repeated text would verify in the wrong occurrence, and
  moved text would open at a new location instead of going stale.
- **Offset-into-file anchors** (raw byte offsets): front-matter edits
  (retitle, reorder) would shift every anchor without touching prose.
- **Line numbers without hash**: inserted lines above would silently
  retarget instead of going stale.
