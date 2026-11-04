# The studio file format

A library is an ordinary folder. Everything the app knows can be read, diffed and edited with a text
editor; nothing important lives in a database, in the app's profile, or in an opaque blob.

```
<library>/
  library.json                 derived catalog — safe to delete
  books/
    book_1f4c8a2b9d3e5a71/
      book.json                idea, outline, cast, memories, settings
      chapters/
        0001-the-door.md       YAML front matter + Markdown prose
        0002-the-lighthouse.md
      images/                  illustrations and character images owned by this book
        img_….png
      images.json              image provenance and chapter attachments
      conflicts/               versions kept when two writers disagreed
      threads/                 agent conversations, one JSON file per thread
      checkpoints/             reserved for draft checkpoints
      .studio/
        checkpoints/           undo points, one JSON file per agent turn
  .studio/
    device.json                identity of this machine
    files.json                 reserved index metadata
    sync/
      device_…json             this device's last scan; never exported
    trash/
      book_…/1719340000000-0002-the-lighthouse.md
```

The library folder can live anywhere: locally, in iCloud Drive, in Google Drive, in Dropbox, on a
network share. The studio makes no attempt to merge providers' conflict files; it surfaces them
(see below).

### Browser storage

The browser build keeps the same tree either in origin-private storage or in a folder the author picks.
The directory-handle adapter writes through a swap file and re-checks the whole-file hash before the
commit point; if another writer changed the file, the old bytes stay and the author's text is preserved
in `conflicts/`. Browser storage can be cleared by the browser; export a portable archive to keep a copy.

## `book.json`

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | Currently `1`. Files with a newer number are refused with an "update the app" error. |
| `id` | string | `book_` + 16 hex characters. Matches the folder name. Never reuse. |
| `title` | string | Shown in the library. May be empty while the author is still deciding. |
| `workingTitle` | string | Optional alternate title. |
| `description` | string | One-line premise. |
| `genres` | string[] | Free-form. |
| `influences` | string[] | Style influences, shown in the Story Bible. |
| `isErotica` | boolean | Gates explicit-content affordances. |
| `chapterRange` | `{ minimum, maximum }` | Planned length. |
| `outline` | string | Markdown outline of the whole book. |
| `storyArc` | object | `beginning`, `middle`, `end`, each with `overview`, `keyMoments[]`, `openQuestions[]`. |
| `characters` | array | `id` (`char_…`), `name`, `role`, `description`, `motivations`, `notes`. |
| `memories` | array | `id` (`mem_…`), `text` (≤180 chars by convention), `importance`, timestamps. |
| `stage` | `onboarding` \| `drafting` | Setup or writing. |
| `settings.manuscript` | object | Export typography: `bodyFont`, `bodyFontSize`, `firstLineIndent`, `lineSpacing`, `chapterTitleAlignment`, `includeTableOfContents`, `preserveLineBreaks`. |
| `settings.agent` | object | Agent behavior: `disabledTools` (withdrawn tool names), `skillsEnabled`, `tone` (free text, at most 500 characters, empty means none), `answerLength` (`brief`, `standard` or `detailed`). Older books gain the defaults on read. |
| `defaultProvider` | string \| null | Provider chosen for this book (`openrouter`, `openai`, `anthropic`, `gemini`, `meta`), or `null` when not chosen. Older books gain `null` on read. |
| `defaultConnectionId` | string \| null | A connection id such as `conn_…`. The secret lives in the app's protected storage, never here. |
| `defaultModelId` | string \| null | Model id as the provider names it. A model that disappears stays recorded and is shown as unavailable. |
| `allowContributorTraining` | boolean | Default `false`. Explicit consent to use a training-eligible model such as Muse Spark Contributor with this book. The model picker sets it; migrations never do. |
| `frontMatter` | record | Free-form front/back matter pages, keyed by page id. |
| `createdAt`, `updatedAt` | ISO 8601 | Written by the app. |

Unknown fields are preserved when a book is written, so a newer app can add fields without the
older one silently dropping them.

## Chapter files

One Markdown file per chapter, named `NNNN-slug.md` (`0001-the-door.md`). The numeric prefix is the
chapter's position when the file was created, and the slug comes from its title; both are only hints.
Moving a chapter rewrites `order` inside the files and never renames them, so after a reorder the
prefixes no longer follow reading order. The order that matters is the `order` field inside the file.

```markdown
---
id: ch_6a1d0f9c2b7e4d13
title: The Door
order: 1
arc: middle
purpose: Introduce the lighthouse and the keeper's routine.
synopsis: The keeper finds the door open and the light already turning.
notes: ""
isPrologue: false
version: 7
createdAt: 2026-10-24T14:02:11.000Z
updatedAt: 2026-10-24T16:41:57.000Z
---

The door had been shut when he went to bed.
```

- `id` is stable for the life of the chapter. Renaming the file or the title never changes it.
- `order` is an integer ≥ 1; the rail sorts by it, then by file name.
- `version` increments on every save the studio performs. It is how the app detects that another
  writer (another device, another editor, a sync provider) changed the file.
- Front matter is written by the `yaml` package and is stable across saves; only the fields above
  are canonical, and unknown keys are preserved.
- The body is Markdown. Line breaks are preserved as typed.

Files with **no** front matter are readable: the app derives an id from the file name, takes the
title from the slug, the order from the numeric prefix, and treats the file as version 1. This keeps
a chapter written in another editor from being invisible.

### Canonical body text

Saving normalises the body so a re-save is a no-op:

- CRLF and CR become LF.
- Leading and trailing blank lines are removed; the file always ends with exactly one newline
  (an empty chapter stays empty).
- Nothing else is touched: no wrapping, no trailing-space stripping, no Markdown rewriting.

### Imported Word documents

A Word document imported by the desktop app becomes ordinary chapter files; the format does not
change. Each body is canonical Markdown made from the document. Each Word paragraph becomes one
block, blocks are separated by one blank line, and each empty paragraph adds one more. Line breaks
are kept. Bold and italic become `**` and `*`, list items become `- ` or `1. ` lines, and quote
paragraphs become `> ` lines. Table cells become plain lines, and a heading that does not title a
chapter stays a `#` line. Text is otherwise kept as written. A chapter's title comes from the heading
that starts it.

Images, footnotes, endnotes, comments, page headers and footers, and the tracking of changes are
not stored in the library. Tracked changes are imported as if accepted. The import report lists
everything left out instead.

## Conversation files

`threads/<threadId>.json` stores one agent conversation. It is written through the same atomic commit
as a chapter and is not part of `library.json`; a missing or stale catalog never loses a conversation.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | Currently `1`. A newer version is refused. |
| `id` | string | `thread_` + at least 6 letters, digits or hyphens. Matches the file name. |
| `bookId` | string | The owning book. |
| `title` | string | Author-facing label; defaults to "New conversation". |
| `createdAt`, `updatedAt` | ISO 8601 | `updatedAt` changes on every save. |
| `messages` | array | Each has `id`, `role`, `parts`, optional `model`, `mode` and `usage`, and `createdAt`. `mode` (`discuss` or `edit`) records the permission level of the turn that produced an assistant message; older messages have none and are shown as unrecorded. |
| `checkpointTurns` | string[] | Turn ids whose checkpoints belong to this conversation. |

Message parts are `text`, `reasoning`, `tool-call`, `tool-result`, `source`, `file`, `error` and
`guidance`. Tool calls and results keep their ids, so a resumed conversation can be inspected
without replaying prose. A call that failed, including one whose tool threw, ends in a `tool-result`
with `isError: true` and an output of `{ "ok": false, "message": … }`. A `guidance` part carries one turn of author instructions (1–2,000
characters, never truncated) with the submitted user message; it applies to that turn only.
The schema lives in `packages/core/src/agent/messages.ts`.

A corrupt file is never rewritten or deleted by a list operation; opening it reports the error. Thread
writes use the library port's checked commit, so a failed write leaves the previous file intact.

## Agent turn checkpoints

`.studio/checkpoints/<at>-<turnId>.json` inside a book folder is the undo point for one agent turn.
`<at>` is the time of the turn's first change, with `:` and `.` replaced by `-`. The turn writes the
file again, whole and atomically, each time it changes a chapter and before the tool answers the
model. A change made after an approval is covered as fully as one made before it. A turn has at most
one file; undo restores from the newest file and then removes it.

| Field | Type | Notes |
| --- | --- | --- |
| `turnId`, `bookId` | string | The turn and its book. |
| `at` | ISO 8601 | When the turn first changed the book. Later saves keep it, so they rewrite the same file. |
| `prompt` | string | The author's request. |
| `entries` | array | One per chapter the turn changed. Undo walks them from last to first. |

Each entry has `chapterId`, `title` and `before`, the body text the chapter had before the turn first
wrote it. Optional fields:

- `created: true` marks a chapter the turn created. Undo moves it to the trash.
- `deleted: true` marks a chapter the turn deleted. Undo moves the chapter's own file back out of the
  trash (see `trashedAt`), so it keeps its id and front matter, then restores its text and details if
  the turn changed them too. When the file is no longer in the trash, `trashedAt` is refused, or the
  entry has no `trashedAt`, undo writes a new chapter with that title and `before` as its text, and
  says so. A
  deleted chapter that is already back in the book is left as it is and reported.
- `trashedAt` is where a deleted chapter's file went, the library-relative path
  `.studio/trash/<bookId>/<file>.md` that the delete returned. Undo accepts no other path, and only a
  file that holds this chapter's id.
- `order` is the 1-based position undo puts the chapter back at. For a deleted chapter it is where the
  chapter stood. For a moved chapter it is where the chapter stood before the turn first moved it.
- `afterHash` is the SHA-256 (hex) of the body text the turn left. Undo leaves a chapter whose body
  no longer has this hash and reports it as skipped, so it never writes over a later edit. The front
  matter is not hashed, because moving one chapter renumbers its neighbours without changing their
  text.
- `meta` holds the chapter's details before the turn first changed them: `title`, `synopsis`,
  `purpose`, `notes`, `arc`, `color` and `isPrologue`. Undo puts them back with a checked write.
- `afterMetaHash` is the SHA-256 (hex) of those seven details as the turn left them, hashed as a JSON
  array in that order. Undo leaves a chapter whose details no longer have this hash and reports it,
  as it does for text. `order`, `version` and the dates are not hashed, for the same reason.
- `outsideEdit: true` marks a chapter someone else wrote in between two of the turn's own changes,
  for example while an approval was waiting: the text or details a tool found were not the ones the
  turn had left. Undo first keeps the chapter's file, byte for byte, as a conflict copy with the
  reason `undo` (see [Saving and conflicts](#saving-and-conflicts)), then restores the chapter. If the
  copy cannot be written, undo leaves the chapter as it is. A chapter the turn created goes to the
  trash whole, so it needs no copy.

Restoring is an ordinary checked save: the body comes back exactly, and `version` and `updatedAt`
move forward. A checkpoint written before `afterHash` existed
restores over the current text, as it always did. One written before `meta`, `afterMetaHash`,
`outsideEdit` and `trashedAt` existed is read as before: it restores no details, keeps no copy, and
brings a deleted chapter back as a new one. A chapter the turn created and then deleted leaves
no entry, and a turn whose changes cancel out leaves no file.

Undo reports how many chapters it restored and how many it skipped, the conflict copies it kept, each
with the chapter's id and title and the copy's library-relative path, and one sentence for each chapter
that did not simply go back.

## Saving and conflicts

Every save carries the version and hash the editor started from. The main process, which is the only
writer, compares them with what is on disk:

| Situation | Result |
| --- | --- |
| Content equals the file | No write, no version bump. |
| `disk.version > base.version` | Conflict copy, reason `newer-version`. |
| `disk.hash ≠ base.hash` | Conflict copy, reason `external-edit`. |
| Otherwise | File replaced atomically, `version + 1`, `updatedAt` refreshed. |

A conflict never overwrites the other writer. The local text is written to
`conflicts/<name>.conflict-<reason>.<deviceId>.<timestamp>.md`, the UI shows both versions, and the
author chooses: *Show the saved copy* or *Load the version on disk*.

An agent edit that waits for the author's approval is checked the same way, against the version and
hash the chapter had when the author was asked. If the chapter was saved in between, an approved
`overwrite_chapter` keeps the file on disk and writes its text as a conflict copy with the usual reason,
and an approved line deletion, split or merge writes nothing.

Undo of an agent turn uses the same folder and naming with the reason `undo`. Before it restores a
chapter that someone else wrote in during the turn, it keeps the chapter's file exactly as it is, and
keeps nothing if the file changed since undo read it.

Writes go through a sibling temp file, `fsync`, and `rename`, with one retry for Windows sharing
violations. Writes for a single book are serialised, so two IPC calls cannot interleave. The temp
file is named `.<file name>.<process id>.<milliseconds in base 36>.tmp`, for example
`.book.json.4242.mhl7x2ps.tmp`. It exists only for the moment of the write; the studio's watcher never
reports a file of that shape, and nothing should sync, edit or keep one.

## Trash

Deleting a chapter moves its file to `.studio/trash/<bookId>/<stamp>-<original name>.md`, where `<stamp>`
is the deletion time in milliseconds since 1970, written in base 36 (`mh3k2x1c-0002-the-door.md`). Nothing
is unlinked. Restoring is a file move back into `chapters/`. Undo of an agent turn makes that move for
a chapter the turn deleted: the file goes back under its original name, or the next free one, with its
id and front matter, and only when no chapter with that id is in the book.

Deleting a book moves its whole folder to `.studio/trash/books/<stamp>-<bookId>/`, with the same stamp. The folder keeps
its `book.json`, chapters, conflicts and checkpoints, so restoring is a move back into `books/`.

## Sync journals

`.studio/sync/<deviceId>.json` is this device's baseline for drift detection: the last observed hash of
each author-owned file, the hash this device last wrote, and tombstones for deletions. It is written
after a reviewed scan, never during one. It contains no prose or credentials, is excluded from portable
archives, and is safe to delete; the next scan rebuilds it by comparing the files and warns that it had
no baseline. A journal copied from another device is ignored by its device id.

## Migration record

`.studio/migrations.json` maps each imported legacy book's content fingerprint to the book it
created: `{ version: 1, books: { "<sha256>": { bookId, title, importedAt } } }`. The fingerprint is
the SHA-256 of the canonical legacy book payload, so a second run over the same export recognises
every book whose target still exists, imports nothing, and names each recognised book in the report.

It contains no prose, only ids, titles, timestamps and hashes. Like sync journals it is excluded
from portable archives: restoring an archive and re-importing the same export imports the books
again. Deleting it is safe; the next run simply imports every book in the export.

## `library.json`

A cache for the library grid: `{ schemaVersion, app: "ai-book-studio", updatedAt, books: [...] }` where
each entry is `{ id, title, description, stage, chapterCount, wordCount, updatedAt }`.

It is derived and best-effort. The app rebuilds it from `books/*/book.json` on open and after each
change, and never reads it as truth. Deleting it is safe; a stale copy in a sync folder is harmless.

## Portable archive

A whole library can travel as a ZIP with a root `manifest.json` (format version, app version,
creation time, entry count, expanded size, and each file's relative path, size and SHA-256). The
archive is a transport format, not a second source of truth: importing writes the ordinary files
back and then opens them.

- Include every author-owned file, including unknown files, images, conflicts and trash.
- Exclude `library.json`, everything under `.studio/` except `.studio/trash/`, and any temporary or
  lock file. Credentials are never in a library and are rejected if an archive claims to contain one.
- Import only into a new or empty folder; never merge with or replace an open library.
- Validate the manifest, normalized relative paths, duplicates, entry count (10,000), expanded size
  (2 GiB total, 512 MiB per file), format/schema versions and every hash before publishing.
- A failed import removes the files it wrote and leaves an existing destination untouched.

The contract is in [`specs/010-web-target/contracts/archive-v1.md`](../specs/010-web-target/contracts/archive-v1.md)
and [ADR 0012](adr/0012-portable-library-archive.md).

## Provider conflict files

When two machines write the same file through a sync service, the service may leave something like
`0002-the-lighthouse (conflicted copy from MacBook).md` or `...sync-conflict....md` in `chapters/`.
The studio lists these under *Earlier conflicts* with a *Show in folder* action and does not treat
them as chapters. Resolving them is a deliberate act by the author, not an automatic merge.

## Version compatibility

`schemaVersion` is checked on read:

- Missing → the file is not ours; the error names the file.
- Greater than the app's → refused, with "This library was written by a newer version of AI Book
  Studio. Update the app to open it."
- Lower → accepted; the app writes the current version on the next save.

## Privacy

Library files are the only copy. The app has no account, no telemetry and no server-side copy. It
writes exactly three things outside the library: the library path in `studio.json`, window bounds in
the same file, and an OpenRouter key (later, in the macOS Keychain).

## Images

`images.json` is the source manifest for `images/`. It is versioned like `book.json`; a newer
`schemaVersion` is refused rather than rewritten. An unknown or corrupt manifest yields an empty
gallery with a warning, and the image files stay on disk.

```json
{
  "schemaVersion": 1,
  "images": [
    {
      "id": "img_6a1d0f9c2b7e4d13",
      "kind": "chapter",
      "chapterId": "ch_6a1d0f9c2b7e4d13",
      "characterId": null,
      "fileName": "img_6a1d0f9c2b7e4d13.png",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1024,
      "bytes": 184320,
      "sha256": "…",
      "prompt": "a lighthouse in a storm, ink and wash",
      "provider": "meta",
      "model": "muse-image-1.0",
      "size": "1024x1024",
      "source": "generated",
      "createdAt": "2026-10-26T12:00:00.000Z",
      "cutoutOf": null,
      "costUsd": 0.01
    }
  ]
}
```

- Image bytes are written first, then the manifest, both atomically through the library port. A
  failed manifest write removes the new file when it can and otherwise reports an orphan.
- `kind` is `chapter`, `character`, `cover` or `other`; `source` is `generated` or `imported`.
  `cutout` is a legacy source: a book saved by an earlier build may hold one, and the studio still
  reads, shows and exports it, but never writes a new one (D-158).
- A chapter has at most one attached image. Attaching another clears the previous `chapterId` in the
  same manifest commit.
- `cutoutOf` is legacy too: on an earlier build's SAM cutout it points at the source image, which was
  never modified. The studio writes `null`.
- The manifest and every image are author files and travel in the portable archive. No image is stored
  in `book.json`, the catalog or the app profile.
