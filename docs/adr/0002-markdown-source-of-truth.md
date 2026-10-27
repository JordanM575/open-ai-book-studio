# 0002 — Markdown files are the source of truth

- **Status:** Accepted (2026-10-24)

## Context

The old app stored `SceneIdea.draftContent` inside a single JSON document. Any schema change meant rewriting the whole library; any write rewrote everything; diffs were unusable; a corrupt byte
could take every book with it. Authors, meanwhile, already think in chapters.

## Decision

A book is a directory.

```
books/<bookId>/book.json            metadata, outline, cast, memories, settings
books/<bookId>/chapters/0001-the-door.md
```

Each chapter is UTF-8 Markdown with YAML front matter for identity (`id`, `title`, `order`, `arc`,
`purpose`, `synopsis`, `version`, timestamps). Prose is the body, verbatim. `book.json` holds
everything that is not prose. Documents are read fully on demand; there is no partial update.

A SQLite database is allowed only as a **derived index** (full-text search, chat transcripts, usage
counters, checkpoints metadata). It must be rebuildable from the files and must never be the only
place a fact exists.

## Consequences

Positive: one edited chapter changes one file; sync clients transfer kilobytes, not megabytes; the
author can read, grep, version and back up their book with ordinary tools; a damaged book is a
damaged folder, not a damaged database; the format is documented in `docs/FORMAT.md` and can be
implemented by anything.

Negative: no cross-file transactions (mitigated by atomic per-file writes and conflict copies); the
catalog must be recomputed or cached; renaming a file is not enough (front matter carries the id);
rich features (comments, inline images) need conventions rather than a schema.

Rejected alternatives: one JSON blob (the old design); SQLite as the primary store (opaque, binary,
conflicts at the file level become catastrophic); a zip/custom container (unreadable to the author
and to sync tools).
