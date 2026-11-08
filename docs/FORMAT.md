# The studio file format

A library is an ordinary folder. Everything the app knows can be read, diffed and edited with a text
editor; nothing important lives in a database or in an opaque blob. The app's profile holds settings,
and words a close or quit could not save until the author restores or discards them (see
[Words kept after a failed close or quit](#words-kept-after-a-failed-close-or-quit)).

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

## Accepted reservations awaiting detailed schemas

ADRs [0019](adr/0019-bounded-autonomous-authoring.md) and
[0020](adr/0020-inline-editorial-review.md) reserve the following locations. **These are not yet
writable formats.** Pure graph/permission/editor contracts can proceed; no writer may infer a wire
schema from these directory names or from an unchecked TypeScript object.

| Reserved location | Accepted ownership / prerequisite |
| --- | --- |
| `books/<bookId>/workflows/<runId>/` | Book-owned run/brief/plans/directions/tasks/attempts/effects/questions/artifacts; field-level schema, exact identity/hash references, bounded streaming, intent/receipt and related-file recovery matrix before writers |
| `books/<bookId>/reviews/<runId>.json` | Immutable absent-only explicit saved report; analyzer/profile/source/coverage/findings attribution, bounded quotes, no full source bodies |
| `books/<bookId>/reviews/dispositions/`, `profiles/`, `campaigns/` | Checked author-owned records; full/segmented continuation and related-report trash/restore rules before writers |
| Existing `books/<bookId>/threads/` v2 | Explicit backed-up migration, checked whole-document revisions/raw hashes, lossless supported unknown fields and future/unknown-semantic read-only behavior before new semantic parts |
| Host-local workflow permission (outside library/archive) | Separate selected-host protected/disclosed store; registration/book/run/policy/generation/expiry/revoke/resume, no prose or credential; missing or copied descriptor grants no execution |

Each detailed format must name every field and optional/default rule; schema/kind/owner/host-issued ID;
safe revisions/generations; raw-byte and semantic limits (including unknown fields); supported JSON/
Unicode/number domain; absent/current/stale no-op semantics; exact publication/readback and failure
receipts; issue-bearing list/read; conflict preservation; explicit migration; archive/sync and recoverable
trash/restore. Cross-file operations are recoverable sequences. No automatic pruning or replay of
uncertain dispatch/publication. Adopt the ADR-specific byte bounds without inventing eviction.
Changing a reservation requires updating its ADR and owning spec. Existing v1 thread behavior below
is current format evidence, not a claim that checked-write migration is complete.

## Checked planning and goal sidecars

D-163–D-168 / [ADR 0017](adr/0017-planning-and-organization.md) define these optional
book-owned files. Worldbuilding create/read/edit and goal set/clear are connected to the current
Library's shared queue, desktop/browser transport and workspace controls. Timeline/beat/story-note
mutation, record archive/restore and the remaining organization journeys are separate delivery work.

### `books/<bookId>/planning.json` (schema 1)

All listed fields are required except `storyNotes`. Objects are loose: supported unknown JSON
fields at every depth survive known-field edits literally, including whitespace inside strings.
Validation never inserts defaults into an existing document. No trimming or Unicode normalization
is applied. The following is a complete minimal saved example:

```json
{
  "schemaVersion": 1,
  "bookId": "book_1f4c8a2b9d3e5a71",
  "revision": 1,
  "worldbuilding": [
    {
      "id": "wb_1234567890abcdef",
      "kind": "worldbuilding",
      "bookId": "book_1f4c8a2b9d3e5a71",
      "revision": 1,
      "archived": false,
      "name": "The salt road",
      "category": "Place",
      "description": "A road beside the sea.",
      "notes": ""
    }
  ],
  "timeline": [],
  "timelineOrder": [],
  "beats": [],
  "beatOrder": []
}
```

Every record has immutable `id`, `kind`, `bookId`, positive safe-integer `revision`, and boolean
`archived`. In addition to the worldbuilding shape above:

| Field | Record kind / ID prefix | Required authored fields |
| --- | --- | --- |
| `timeline[]` | `timeline` / `tl_` | `title`, `when`, `description`, `notes` |
| `beats[]` | `beat` / `beat_` | `title`, `summary`, `notes` |
| `storyNotes` (optional single object) | `story-notes` / `sn_` | `workingNotes`, `styleNotes`, `synopsis` |

`timelineOrder` and `beatOrder` each contain exactly the corresponding retained record IDs once,
including archived records; hiding archived entries never destroys their position. Lists retain
at most 200 records each, active and archived combined. Names/titles must be nonblank; names,
titles, categories and literal `when` labels have at most 200 **UTF-16 code units**. All other
authored text fields have at most 20,000 code units. IDs have prefix-specific suffixes matching
`[A-Za-z0-9-]{6,40}`; hosts generate them, never the editor. IDs are unique across all retained
records. Every record owner equals the file owner and the actual owning `book.json` ID.

### `books/<bookId>/goals.json` (schema 1)

```json
{
  "schemaVersion": 1,
  "bookId": "book_1f4c8a2b9d3e5a71",
  "revision": 1,
  "targetWords": 50000
}
```

`targetWords` is a positive safe integer or `null`. Clearing an existing goal saves `null`,
preserving unknown fields; it does not delete the file. Clearing an absent goal is a no-write
operation. Counts are derived, never stored here: complete verified saved chapter snapshots yield
`savedWords` and `remaining` (null without a target, otherwise floored at zero). Unreadable chapters
yield `incomplete` with an issue count and no total/remaining; changed or unverifiable sources yield
`unavailable`. Two saved reads must agree on book identity, chapter enumeration, IDs, paths,
versions, raw hashes, bodies and read issues; the goal token is rechecked too. Each enumerated source
is independently read and its exact raw SHA-256 recomputed, decoded with fatal UTF-8, and compared
against its canonical saved body and recorded identity/version. History's quiet plain-value front
matter reader is reused; unsupported metadata makes this count unavailable without changing the
ordinary chapter view. Valid headerless saved text remains countable. Empty books are a complete
zero. The host owns complete enumeration. This is point-in-time verification, not a filesystem
transaction or draft count.

The integrated reader uses fresh directory enumeration, retains duplicate-ID files as read issues
instead of silently counting only the preferred copy, and compares the filesystem adapter's inspected
entries to the readable listing. Unsupported chapter entries, omitted inspected files and iCloud
placeholders cannot confirm a total. A recorded chapter `bookId`, when present, must match the owner.
Valid headerless and partial-metadata chapters retain the existing deterministic fallback identity.
Observed external changes, saved chapter hashes/enumeration/read issues, explicit refresh, window
focus and planning write outcomes invalidate displayed progress. Dirty/pending/failed/conflicting
editor state is separately labelled and never supplies the saved count.

### Sidecar mutation and recovery

Both files have an exact **2,500,000 UTF-8 byte** budget, including unknown fields, two-space
indentation and a final newline in new serialized output. Reads check stat and actual returned
bytes; writes check the baseline input and complete proposed output separately. Unknown fields
are never dropped to make room. Missing means empty without creating directories or files.
Malformed, over-budget, foreign-owner, newer-schema and copy-only documents in an active location
are unavailable and write-refused. An invalid sidecar does not invalidate the rest of the book.

The core save envelope is `{bookId, source, baselineJson, draft}`. `source` is exactly
`{kind:"absent", revision:0}` with `baselineJson:null`, or
`{kind:"sha256", value:<64 lowercase hex>, revision:<positive safe integer>}` with the exact raw
UTF-8 JSON string returned by read. The service checks that string's hash/revision/owner. `draft`
is a strict typed intent: `create-worldbuilding` with `{name,category,description,notes}` fields,
`edit-worldbuilding` with an existing `id` and those fields, or (for goals) `set-goal` with
`targetWords`. No path, generated ID, revision, owner, arbitrary document replacement or unrelated
field patch is accepted in a draft. The full intended document is constructed from that bounded
baseline plus draft; this preserves unknown/unrelated fields without trusting an editor to resend
them correctly. The request carries only one full baseline and bounded authored fields, within
the ADR's two-document allowance: the raw baseline and serialized `{bookId,draft}` are each capped
at 2,500,000 bytes. Strict control validation rejects additional keys. Each unquoted JSON number
must retain its exact mathematical decimal value when parsed and serialized as a JavaScript Number.
Overflow, underflow, rounded decimals/integers and negative zero are refused before mutation,
including in nested unknown fields and recovery baselines. Supported numeric spelling may change
(for example, `1.00` to `1`); numeric-looking strings remain literal. Known revision/target fields
additionally require safe integers. Refusal leaves the original bytes intact.

Under the owning Library's existing book queue, validate the actual book and independently
supported sidecar, then compare exact absence/hash **and** revision. Only a current semantic
no-op writes nothing. A real operation increments the file revision once and its edited record
revision once; host-created records start at 1. Incrementing `Number.MAX_SAFE_INTEGER` is refused.
One checked absent/SHA commit is allowed, through the Library's existing journal-aware commit
hook. There is no retry, rebase, merge, catalog update or book timestamp change.
A current semantic no-op keeps even a compact source whose pretty-printed form would exceed the
budget: it does not reserialize or publish that form.

A stale request (even a same-content request), missing-after-read or commit race preserves its
complete intended document under
`books/<bookId>/conflicts/<planning|goals>.conflict-<external-edit|missing-file>.<deviceId>.<timestamp>[-N].json`.
The copy adds a reserved `conflictMetadata` object with `reason`, original `baseline` token and
observed token. Recovery copies are bounded to 5,000,000 bytes. Colliding names use absent-only
suffix attempts; returned bytes and their hash must verify before reporting `conflict`/`savedAs`.
Only conflict-copy names may be retried, never the active-file commit. A copy cannot be loaded as
an active baseline; eventual explicit recovery must remove the copy-only context and create a
fresh reviewed edit. Both the active write and copy publication can be uncertain after an adapter
error or mismatching readback: report `uncertain`, keep the editor draft and reread storage; never
replay automatically or remove a possibly published file. Copy failure never claims a durable copy.
Owner/schema checks run again before copy creation and each publication attempt.

Transport preserves exact raw baselines, validates strict request/result envelopes and verifies reply
owner, raw hash, revision and submitted fields. Only known request-admission failures return
`outcome: "refused"`; unknown exceptions remain uncertain. Write errors retain `phase: "active" |
"recovery"` and `outcome: "uncertain" | "not-kept"`. The browser adapter marks a `changed` result
after publication with `publication: "uncertain"`; planning treats that as an uncertain outcome,
never as a prepublication conflict or a collision to retry. This adds no cross-process CAS guarantee.

Workspace recovery lists planning/goal copy names in pages of 25 (a display window, not a retention
limit). Inspection verifies bounded raw bytes, hash, schema, owner and copy-only metadata; a named
copy that cannot be verified stays unavailable. Recovery is explicit manual review: inspect the
read-only document, reopen the appropriate current editor, enter the chosen fields and submit a new
checked edit. There is no whole-document restore endpoint or automatic loading of copy metadata as
active state. Newer active unknown fields remain owned by the current baseline. Native close and
shell book/library navigation are blocked until the matching dialog resolves pending/dirty/uncertain
state; after closing an editor, retry the navigation action. Abrupt process termination cannot retain
an in-memory draft or cancel a publication already sent.

Book-side files and their conflict copies travel in folder copies, portable archives and whole-book
trash/restore. Collection and annotation file writers, recents and annotation navigation are not
part of this first slice; their accepted contracts remain in ADR 0017.

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
| `storyArc` | object | `beginning`, `middle`, `end`, each with `overview`, `keyMoments` and `openQuestions`: text, one line per item. An array of strings, the shape this page once described, is read as one line per item and stays an array on disk until that part is edited. |
| `characters` | array | `id` (`char_…`), `name`, `role`, `description`, `motivations`, `notes`. |
| `memories` | array | `id` (`mem_…`), `text` (≤180 chars by convention), `importance`, timestamps. |
| `stage` | `onboarding` \| `drafting` | Setup or writing. |
| `settings.manuscript` | object | Export typography: `bodyFont`, `bodyFontSize`, `firstLineIndent`, `lineSpacing`, `chapterTitleAlignment`, `includeTableOfContents`, `preserveLineBreaks`. |
| `settings.agent` | object | Agent behavior: `disabledTools` (withdrawn tool names), `skillsEnabled`, `tone` (free text, at most 500 characters, empty means none), `answerLength` (`brief`, `standard` or `detailed`). Older books gain the defaults on read. |
| `defaultProvider` | string \| null | Provider chosen for this book (`openrouter`, `openai`, `anthropic`, `gemini`, `meta`), or `null` when not chosen. Older books gain `null` on read. |
| `defaultConnectionId` | string \| null | A connection id such as `conn_…`. The secret lives in the app's protected storage, never here. |
| `defaultModelId` | string \| null | Model id as the provider names it. A model that disappears stays recorded and is shown as unavailable. |
| `allowContributorTraining` | boolean | Default `false`. Explicit consent to use a training-eligible model such as Muse Spark Contributor with this book. The model picker sets it; migrations never do. |
| `frontMatter` | record | Legacy free-form pages, keyed by page id (an earlier studio's subtitle, author, dedication and so on). Kept exactly as written and never exported; the Format dialog lists what it holds and converts it into `matter` only when the author asks (D-169). |
| `matter` | object, optional | Ordered front and back matter (D-169), below. Absent in older books. |
| `createdAt`, `updatedAt` | ISO 8601 | Written by the app. |

Unknown fields are preserved when a book is written, so a newer app can add fields without the
older one silently dropping them. That holds at every level: inside each character and memory, the
story arc and its three parts, `chapterRange` and every `settings` section, as well as at the top.

### Saving `book.json`

Several writers share `book.json`: the Story Bible, the book and format settings, the model picker,
the agent's book tools, the `bookwriter` toolkit and other devices through a sync folder. It has no
`version`, so a save works field by field:

- The editor sends only the top-level fields it changed, each with the value it started from.
- The main process reads the file again under the book's write lock and merges each change onto that
  read. A field the editor did not change is never written. Unknown keys survive at every level, and
  a part nobody changed keeps the shape another writer gave it. The exception is a list of records
  that is written: each of its records is written in this build's shape, so a missing default such
  as `notes: ""` is filled in.
- Objects merge key by key. `characters` and `memories` merge record by record, by `id`, so an added
  memory and an edited character never collide. A record's `updatedAt` takes the later stamp.
- The default provider, connection and model (`defaultProvider`, `defaultConnectionId`,
  `defaultModelId`) are one choice. An editor that changes any of them sends all three, and if another
  writer changed any of them since the editor read, the file keeps all of their choice and the
  editor's whole choice goes to the copy, so a connection is never paired with a model it does not serve.
- The file is replaced atomically, and only while it is still the version that was read. If another
  writer got in between, the merge runs again on the new read.
- Where another writer changed the same part since the editor read it, the file keeps their value and
  the editor's whole version of the book is kept as
  `conflicts/book.conflict-external-edit.<deviceId>.<timestamp>.json`. The parts only the editor
  changed are saved as usual. The Story Bible says which fields overlapped and offers to show the copy;
  the agent's tools tell the model where the copy went. The copy is listed with the book's other
  conflict copies, so the workspace's saved-copies banner offers it too.

A caller with no earlier read, such as the import, replaces whole fields instead. It leaves every
part it did not change as it was written, and if the file changed while it was saving it keeps its
update as a conflict copy rather than writing over the change.

### Front and back matter

`matter` holds the pages around the chapters, in the order the author set:

```json
"matter": {
  "version": 3,
  "titlePage": true,
  "author": "Ana Reyes",
  "subtitle": "A tidewater tale",
  "sections": [
    { "id": "mat_3f9c2a1b7d4e", "kind": "copyright", "position": "front", "title": "", "text": "Copyright © 2026 Ana Reyes\nAll rights reserved." },
    { "id": "mat_8a1e0c55b2f9", "kind": "dedication", "position": "front", "title": "", "text": "For those who wait." },
    { "id": "mat_c41d7e9a0b36", "kind": "about-the-author", "position": "back", "title": "About the author", "text": "Ana lives by the sea." }
  ]
}
```

| Field | Notes |
| --- | --- |
| `version` | Incremented on every accepted save, like a chapter's `version`. |
| `titlePage` | Whether a generated title page (title, subtitle, author) opens every export. |
| `author`, `subtitle` | The title page's byline and second line, at most 300 characters each. |
| `sections[].id` | `mat_` + 6 to 40 letters, digits or hyphens; unique in the list. |
| `sections[].kind` | `copyright`, `disclaimer`, `dedication`, `epigraph`, `acknowledgements`, `about-the-author` or `other`. |
| `sections[].position` | `front` (before the chapters) or `back` (after them). |
| `sections[].title` | The page's heading, at most 200 characters; empty means the page shows none. |
| `sections[].text` | Markdown, at most 50,000 characters, set like a chapter body: a paragraph is a line. |

At most 40 sections. The app writes the front sections first, then the back ones, each side in the
author's order. Every export uses one order: the title page, the front sections, the contents page
when the book asks for one, the chapters, then the back sections. A book whose `matter` is absent,
`null`, or empty (title page on, no author, no subtitle, no sections) exports exactly as before
ordered matter existed, with the title and description on its title page. Once the matter holds
anything, the title page shows the title, subtitle and author, and the description stays out of
it (Word and EPUB files keep it in their metadata).

The app reads `matter` without stopping the book from opening: a value it cannot read is kept as it
is, the Format dialog says so, saves never write over it, and every export stops with that reason
rather than leaving the matter out. Fields inside `matter` that the app does not know are kept when it
saves. Only the matter save writes `matter`; a general book update never does. The format of
`matter` changes only with `schemaVersion`.

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

- `id` is stable for the life of the chapter. Renaming the file or the title never changes it. One
  file is the chapter for an `id`; a sync tool's copy is not (see [Copies of a chapter](#copies-of-a-chapter)).
- `order` is an integer ≥ 1; the book reads in its order, and chapters on the same number by file
  name, so every device shows one order. The numbers need not run without gaps: deleting a chapter
  leaves one, and a move keeps them. A move gives the chapters it shifts the numbers those places
  had and rewrites only their files, so moving a chapter from 120th to 118th rewrites three files
  however long the book is. Each of those files is an atomic write checked against its hash, and
  `version` moves on. A move cut short, for example by a crash, can leave the moved chapter and its
  new neighbour on one number; the book still reads in one order, with every other chapter in its
  place, and the next move gives each chapter a number of its own.
- `version` increments on every save the studio performs. It is how the app detects that another
  writer (another device, another editor, a sync provider) changed the file.
- Front matter is written by the `yaml` package and is stable across saves; only the fields above
  are canonical, and unknown keys are preserved. Whitespace at the end of a value, including blank lines at the end of a block scalar, is part of the value and is kept.
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

## Chapter history

`books/<bookId>/history/<chapterId>/<timestamp>-<label-slug>[-n].md` holds one saved-text
record per ordinary file (D-175/D-176, [ADR 0016](adr/0016-chapter-history.md)). The timestamp
is UTC ISO with milliseconds and `:`/`.` replaced by `-`; the slug is a 60-character
filename hint, never identity. Collisions append `-2`, `-3`, etc., with absent-only atomic
commits. Creating a record never replaces an existing record; intent transitions use the checked update described below. Capture is explicit and never runs on ordinary saves.
The filesystem adapter's existence check and rename are not a cross-process compare-and-swap;
an external writer racing between them is outside that guarantee. Returned bytes are checked
against the intended snapshot. A write/readback failure can leave a complete snapshot: review
history before retrying. The core never automatically retries or deletes an unconfirmed write.

Front matter is required, followed by a blank separator line and the canonical Markdown body:

| Field | Contract |
| --- | --- |
| `schemaVersion` | `1`; future versions are refused without rewriting. |
| `id` | Stable `hist_` plus at least six letters, digits or hyphens. |
| `kind` | `snapshot`, `safety`, or `intent`. The current capture operation creates only `snapshot`. |
| `bookId`, `chapterId` | Stable owning IDs; both must match the requested history directory. |
| `label` | Nonblank single line, at most 200 Unicode code points, no control characters. Explicit capture trims surrounding whitespace; reads never trim or truncate metadata. |
| `capturedAt` | UTC ISO 8601 with exactly millisecond precision. |
| `sourceVersion` | Nonnegative safe integer: version of the saved source chapter. |
| `sourceHash` | Lowercase hexadecimal SHA-256 of the raw source chapter file. Historical provenance, not a later restore base. |
| `bodyHash` | Lowercase hexadecimal SHA-256 of the UTF-8 canonical body; intents use the empty body's hash. |

Intent metadata additionally contains `selected` and `safety` references, each with
`fileName`, `id`, and `hash` (raw history-file SHA-256), and `intendedBodyHash`.
`sourceVersion`/`sourceHash` identify its checked pre-restore base. Its `state` is `prepared`,
`applied` (requires `result: { version, hash }`), or `undone` (requires both `result` and
`undoResult: { version, hash }`). Prepared intents have neither result; applied intents
have no undo result. Intent bodies are empty.

The restore core adds optional loose `plannedResult: { version, hash }` and
`plannedUndoResult: { version, hash }`. These hold the next complete serialized chapter's exact
version and raw-file SHA-256, computed before the respective write, not just its body hash.
`plannedResult` remains through applied/undone states; `plannedUndoResult` is allowed only on
applied/undone intents. When present, finalized results must equal their plans. Older records
remain readable; a prepared intent without an exact plan is uncertain. Recovery reads never replay
writes or infer ownership from matching prose. Exact identity matches permit checked undo of a
restore, including interrupted finalization; an interrupted undo plan is reported for review, not
silently retried. Identity is not authenticated provenance.

Restore verifies a visible safety record and prepared intent before starting the chapter writer.
Undo persists its plan in that intent first. Updates are expected-raw-hash guarded, with unknown
supported fields preserved. Both operations exact-check current version and raw hash within the
existing book queue, including equal bodies, and use the journal-aware checked writer. They preserve
current metadata values and replace only the body plus normal version/update-time bookkeeping;
even equal-body operations increment the version. Cancellation before history publication changes
nothing; after safety publication it retains safety and prepares the intent before stopping. Once
chapter writing starts, the actual saved/conflict/uncertain outcome wins over cancellation. Failed or
uncertain writes never delete selected, safety or intent material. IPC/UI and live host draft/save
gating are separate obligations; the core cannot observe editor state.

All known metadata objects are loose: supported unknown fields survive codec round-trips,
including nested references/results. Supported metadata contains plain string-keyed mappings,
dense arrays, strings, booleans, null and finite numbers. Integer numbers must be safe integers;
negative zero and numeric tokens whose value would round or underflow during serialization are
refused. Complex keys, unsupported YAML tags, Set/Date/Map values, cycles, `__proto__`, accessors
and other non-data/foreign JS values are refused before schema conversion; they are never silently
changed into another type. Acyclic alias values survive, without promising comments, anchor names
or object-graph identity. Serialization snapshots this validated metadata before asynchronous work.
No read writes back. Invalid YAML, missing required data,
wrong identity, unsupported schemas and body-hash mismatches are unavailable records, left
intact for recovery. Listing reports them individually. Parsing errors never include prose;
the complete history source-resolution path uses quiet parsing and fatal UTF-8 decoding.
Canonical body hashing uses the same normalization as chapter bodies; front-matter formatting
is not covered by `bodyHash`. An open result also reports the record's raw-file hash.

Capture requires a confirmed saved state and exact source version/hash, reads only the saved
file, and requires its persisted chapter ID (headerless fallback IDs cannot anchor history).
It verifies raw source hashes and refuses a changed, missing, unreadable or future-schema source. It never flushes a draft or
changes chapter bytes. Hosts must check their live draft/save state before requesting capture.
List/open work even while the chapter is in trash; comparison requires the current saved
chapter and identifies its two bodies as saved text, excluding any draft.

History follows a stable chapter ID through title, filename and order changes. Chapter trash
leaves history in the book; whole-book trash carries it with the entire folder. Portable
archives include ordinary files' exact bytes and hashes by the author-file rule, including
unknown or unavailable record contents; history validation happens when those records are read.
Filesystem links and special entries are unsupported. Direct access refuses them; metadata-only
history inspection lists unsupported `.md` entry names as unavailable without reading their
targets. They remain excluded from ordinary archive traversal.
No automatic pruning, count/size quota, expiry or compaction applies, including to intents.
List sizes come from storage stats, not a format field. Storage failures never delete recovery
material. Future explicit deletion must move a record to recoverable chapter trash and protect
restore dependencies; no deletion operation is provided by the saved-only core.

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
| `messages` | array | Each has `id`, `role`, `parts`, optional `model`, `mode` and `usage`, and `createdAt`. New user submissions and assistant outcomes record their fixed turn `mode` (`discuss` or `edit`); older messages have none and are shown as unrecorded, never inferred from the current composer. |
| `checkpointTurns` | string[] | Turn ids whose checkpoints belong to this conversation, newest last: each turn that changed the book and saved its checkpoint, including one stopped while it waited for approval and one that failed before it stored a reply. Undo takes the book's newest checkpoint, so the chat offers it only on the last of these, and names that turn: if another change now owns the newest checkpoint, nothing is undone (see [Agent turn checkpoints](#agent-turn-checkpoints)). An undo removes its turn from every conversation that lists it. A branch copies its source's list when it keeps the newest of these turns, and starts with none otherwise. |

Message parts are `text`, `reasoning`, `tool-call`, `tool-result`, `source`, `file`, `error` and
`guidance`. Tool calls and results keep their ids, so a resumed conversation can be inspected
without replaying prose. A call that failed, including one whose tool threw, ends in a `tool-result`
with `isError: true` and an output of `{ "ok": false, "message": … }`. An approved overwrite, line
deletion, split or merge that found its chapter changed since it was proposed also carries
`"changedSinceRead": true` and the `chapterId`, and an overwrite carries `savedAs`, the library-relative
path of the conflict copy that holds its text (see [Saving and conflicts](#saving-and-conflicts)). A `guidance` part carries one turn of author instructions (1–2,000
characters, never truncated) with the submitted user message; it applies to that turn only.
The schema lives in `packages/core/src/agent/messages.ts`.

Stored error explanations are limited to 2,000 UTF-16 code units. Longer provider details carry an
explicit shortening marker; retry-wait explanations and checkpoint-loss warnings are retained.
The numeric `retryAfterSeconds` field supports up to 86,400 seconds. A longer provider wait is
preserved as seconds in the stored explanation instead of being clamped; the live terminal event
still carries the original wait. Conversation validation or persistence failure cannot suppress
the turn's terminal event.

A corrupt file is never rewritten or deleted by a list operation; opening it reports the error. Thread
writes use the library port's checked commit, so a failed write leaves the previous file intact.

## Agent turn checkpoints

`.studio/checkpoints/<at>-<turnId>.json` inside a book folder is the undo point for one agent turn.
`<at>` is the time of the turn's first change, with `:` and `.` replaced by `-`. The turn writes the
file again, whole and atomically, each time it changes a chapter and before the tool answers the
model. A change made after an approval is covered as fully as one made before it. A turn has at most
one file; undo restores from the newest file, then removes it and takes its turn out of every
conversation's `checkpointTurns` (see [Conversation files](#conversation-files)). Each write and removal
is noted in this device's sync journal (see [Sync journals](#sync-journals)), so a drift scan does not
list the studio's own checkpoints; one written or removed by another device is still listed. The newest
file is the one whose name sorts last. An undo that names its turn, as the chat's does, goes ahead only
while the newest file is that turn's; otherwise it restores nothing, removes nothing, and says which
request and chapters the newest file holds. The control plane's undo route accepts the same turn id. The
ambient strip, the CLI, MCP and the phone name no turn and take the newest file.

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
author chooses: *Show the saved copy* or *Load the version on disk*. A Story Bible or settings save
that overlaps another writer keeps the author's `book.json` the same way, as
`conflicts/book.conflict-external-edit.<deviceId>.<timestamp>.json` (see
[Saving `book.json`](#saving-bookjson)).

One conflicted save writes one copy. The editor never saves words a copy already holds against the
same base again, and drops the draft it held for them, so loading the version on disk, closing and
quitting write no second copy. Words typed after the conflict are new, so they get a copy of their own.

An agent edit that waits for the author's approval is checked the same way, against the version and
hash the chapter had when the author was asked. If the chapter was saved in between, an approved
`overwrite_chapter` keeps the file on disk and writes its text as a conflict copy with the usual reason,
and an approved line deletion, split or merge writes nothing. The chat says so on the step, and offers
the overwrite's copy.

The front and back matter saves the same way: the save carries the `version` and a SHA-256 of the
matter the author started from (its JSON as the app parsed it). When either no longer matches what is
on disk, nothing is written over it: the author's matter is kept as
`conflicts/front-and-back-matter.conflict-<reason>.<deviceId>.<timestamp>.json`, a JSON object
`{ "matter": … }` exactly as they had it, and the Format dialog shows the matter now on disk with the
copy's name and a *Show the saved copy* action. A `book.json` that another writer replaces while the matter is saving is refused, and the
author's change is saved again on their next change or when the dialog closes.

Ordinary book metadata updates also commit against the SHA-256 of the `book.json` snapshot they
read. If another writer changes that file before the commit, the newer bytes stay in place and the
studio's proposed book is kept as `conflicts/book-metadata.conflict-external-edit.<deviceId>.<timestamp>.json`
with shape `{ "book": … }`. The update reports the conflict instead of claiming it was saved.

Undo of an agent turn uses the same folder and naming with the reason `undo`. Before it restores a
chapter that someone else wrote in during the turn, it keeps the chapter's file exactly as it is, and
keeps nothing if the file changed since undo read it.

Writes go through a sibling temp file, `fsync`, and `rename`, with one retry for Windows sharing
violations. Writes for a single book are serialised, so two IPC calls cannot interleave. The temp
file is named `.<file name>.<process id>.<milliseconds in base 36>.tmp`, for example
`.book.json.4242.mhl7x2ps.tmp`. It exists only for the moment of the write; the studio's watcher never
reports a file of that shape, and nothing should sync, edit or keep one.

## Words kept after a failed close or quit

When the last save before a window closes or the studio quits cannot write a chapter (a full disk, a
read-only or locked folder, a chapter file that is missing, a library folder renamed while open), the
unsaved text is kept in the studio's own profile, never in the library, at
`<userData>/recovery/rec_<16 hex digits>.json`:

```json
{
  "version": 1,
  "id": "rec_0f3c9a1b2d4e5f60",
  "bookId": "book_1f4c8a2b9d3e5a71",
  "chapterId": "ch_6a1d0f9c2b7e4d13",
  "content": "The whole chapter text as it was in the editor.",
  "baseVersion": 4,
  "baseHash": "…",
  "keptAt": "2026-11-04T07:15:00.000Z",
  "reason": "The disk is full. Nothing was replaced.",
  "libraryRoot": "/Users/…/Writing"
}
```

- `baseVersion` and `baseHash` are the chapter's version and SHA-256 the words were typed against.
  `libraryRoot` is shown, never matched: a library folder that was renamed keeps its book ids.
- Each file is written atomically with mode `0600`, in a folder with mode `0700`. A failure that
  repeats writes a new file, so later words never replace earlier ones; an identical copy (same
  chapter, base hash and text) is written once. A file that does not read is reported and left alone.
- The author is asked before the studio closes or quits with kept words: keep it open, or leave with
  the words kept. A hidden run logs the counts and the reason instead.
- A kept copy is offered when its book opens. *Restore words* saves it through the checked save above,
  so a chapter that changed since keeps the words as a conflict copy; the file goes once that save
  returns. *Discard words* asks first, then removes the file. Nothing else removes one: not a later
  save, not a restart, not a timer.
- It is a disposable draft, not a second source of truth. Nothing reads it as the chapter, it never
  travels in a portable archive, and deleting the folder loses only words the author has not restored.
  The browser build keeps none; its drafts are flushed into storage when the page hides.

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
after a reviewed scan, never during one. The chapters, conversations, images and agent checkpoints
the studio writes or removes are noted in it as this device's own, so a scan does not list them. For
an existing file, the intended save hash is recorded before the atomic file commit as well as the
observed hash after it. If the process stops between those writes, a later scan still recognizes the
exact committed bytes; a different on-disk hash remains an outside change for review. A
conflict copy is not, because the save that made it still needs the author's review. Notes take
turns, so two made at once both land. It contains no prose or credentials, is excluded from portable
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

## Copies of a chapter

When two machines write the same file through a sync service that cannot merge them, the service
keeps both, and the copy keeps the original's front matter, `id` included. Exactly one file is a
chapter's own file. The studio lists, opens, saves, edits the details of and trashes only that file;
every other file is a copy.

A file in `chapters/` is a copy by its name when it carries one of these marks:

| Source | Example |
| --- | --- |
| iCloud Drive | `0002-the-lighthouse 2.md` |
| Google Drive | `0002-the-lighthouse (1).md` |
| Dropbox, Nextcloud | `0002-the-lighthouse (MacBook's conflicted copy 2026-11-04).md`; Dropbox's `(Case Conflict)` and `(Selective Sync Conflict)` too |
| Syncthing | `0002-the-lighthouse.sync-conflict-20261104-093000-ABCDEF1.md` |
| This studio | `0002-the-lighthouse.conflict-external-edit.<deviceId>.<timestamp>.md` |

The iCloud and Google Drive marks count only after a name the studio writes, `NNNN-slug.md`, so a
chapter named `Chapter 2.md` in another editor is still a chapter. Only the exact marks count, so
`Part Two (The Conflict).md` is a chapter too. A copy by name is never read as a chapter, whatever
its front matter says.

When several readable files without such a mark carry one `id`, the chapter's own file is chosen by
name alone:

1. a name the studio writes, `NNNN-slug.md` (`0002-the-lighthouse.md`, or `0002-the-lighthouse-2.md`
   when that name was taken);
2. then the shorter name;
3. then the first name in character order.

The rest are copies. File dates are not used, for two reasons: every device must pick the same file,
and an atomic save gives the chapter's file a new creation date, so "the oldest file" would hand the
chapter to its copy at the next save. A copy that is newer, by date or by `version`, never takes the
original's place.

The studio never writes, renames, moves or deletes a copy. It stays where the sync tool put it and is
listed beside the copies in `conflicts/`: the workspace counts them in its *saved copies from earlier
sync conflicts* line, whose *Show in folder* action opens the folder at the first copy, and the sync
review lists the copies named as such. Resolving a copy is a deliberate act by the author, not an automatic merge. Deleting a chapter
trashes only its own file, and a copy named as one stays a copy. A copy that carries no mark, such as a
Finder duplicate (`0002-the-lighthouse copy.md`), is told apart only while the original is there: once
the original is in the trash, the copy is the only file with that `id` and opens as the chapter.

## Version compatibility

`schemaVersion` is checked on read:

- Missing → the file is not ours; the error names the file.
- Greater than the app's → refused, with "This library was written by a newer version of Open Book
  Studio. Update the app to open it." The same check runs before every write into the book, because
  another device may upgrade `book.json` while the book is open. A chapter save, a new, moved,
  deleted, restored, merged or split chapter, a kept copy, the Story Bible and every settings save,
  images, conversations, moving the book to the trash, the agent's tools and the toolkit's saves are
  all refused with that message before anything is written.
- Lower → accepted; the app writes the current version on the next save.

A book folder that does not open is never hidden. The library shows it as a card that says why, with a
*Show in Finder* action on desktop (*Show in folder* off macOS), and leaves its folder exactly as it is:

| `book.json` | The card says |
| --- | --- |
| A newer `schemaVersion` | "This book was saved by a newer version of the studio", with the title it carries |
| Missing, empty, or an iCloud `.book.json.icloud` stand-in | "This book is still syncing" |
| Anything else that does not read: not JSON, no `schemaVersion`, the wrong shape, no permission | "This book's details could not be read" |

`library.json` lists only the books that open.

## Privacy

Library files are the only copy. The app has no account, no telemetry and no server-side copy. It
writes exactly four things outside the library: the library path in `studio.json`, window bounds in
the same file, an OpenRouter key (later, in the macOS Keychain), and words a close or quit could not
save, in `recovery/` in the same profile, until the author restores or discards them.

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
