# ADR 0008: Import an earlier studio's export, one way

- **Status**: Accepted
- **Date**: 2026-10-24
- **Related**: spec 003, docs/FORMAT.md

## Context

An earlier studio keeps a whole library in one browser storage value and offers a JSON export:
`{ app: "moms-ai-book-studio", version: 1, kind: "library" | "book", exportedAt, books, libraryMeta,
chatState, images }`, where each book embeds its chapters as `scenes[].draftContent`, its planning data,
image pages, and where `images` maps version ids to `{ mimeType, base64 }`.

This studio stores one folder per book, one Markdown file per chapter, planning data in
`book.json`, and images as files. There is no database to import into and no server involved.

The options were:

1. **Read the old export and write the new format** (chosen).
2. Teach the new app to read the old format in place, indefinitely.
3. Ship a converter that runs inside the old app, producing new-format files from the browser.
4. Build a two-way sync bridge between the two formats.

## Decision

Import **one way**, from the old export file, in the new app's main process, writing only the new
format.

- The importer accepts the wrapped library export, a single-book export, a bare library state, and a
  single book object, because authors saved all four shapes.
- Every book is written into a temporary folder and published atomically; a failed run leaves no
  half-book in the library.
- Old identifiers are stored as references (`legacyId`) so a second run recognises what exists and
  writes nothing, rather than trusting titles.
- Unsupported data — checkpoints, undo records, tour state, keys, live conversations, the old model id
  — is named in a report. Conversations are archived inside the book folder, never replayed.
- The export file is opened read-only and is never moved, modified or deleted.
- A completed import can be undone by moving exactly the books it created to the library trash.

Rejected alternatives:

- **Read the old format forever** — a second schema to maintain, and a permanent excuse to keep
  browser-storage assumptions in a file-based product. It also makes every future change consider two
  shapes of the same entity.
- **Converter inside the old app** — the old app is being retired; shipping new code into it to move
  data out is work on the wrong side, and browsers cannot write folders reliably at this size.
- **Two-way bridge** — a sync engine between a localStorage blob and a folder tree would reintroduce
  exactly the whole-library writes, version ambiguity and silent overwrites the new format exists to
  remove.

## Consequences

- Migration is a door: after it, the two libraries diverge, and the author is told so before
  confirming.
- The importer is a compatibility surface that will live for a long time. It is specified as behaviour
  (spec 003) and tested against fixtures that stay in this repository.
- Because the old format has no per-chapter file identity, chapter ids are new; any old reference to a
  chapter (image anchors, conversation links) is remapped at import time and otherwise not preserved.
- Books with no scenes but a legacy whole-book `manuscript` string become one chapter. Splitting is
  left to the author rather than guessed.
- Every skipped item must be reported; the report is itself a product surface, not a log.
