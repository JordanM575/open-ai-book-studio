# Feature Specification: Import an Earlier Studio's Export

**Feature Branch**: `003-earlier-studio-import`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "think how we can also have a port from old version to new version" — carry the earlier app's library into AI Book Studio without losing manuscript text, planning data or images.

## Overview

Authors arrive with books from an earlier studio. Those books live in one browser storage value and
leave it only as a JSON export: a wrapped library (or single book) containing books, chapters in
`scenes`, planning data, manuscript settings, front and back matter, image pages, and base64 image
bytes. AI Book Studio stores books as folders of Markdown files and image files.

This feature moves an author from one to the other: read the export, create a new-format library,
write every chapter as a Markdown file, carry planning data and images, and report exactly what
crossed and what did not. It never writes the old format, never edits the export, and never guesses
when it can ask.

The import is a door, not a bridge: the earlier studio can keep running on its own copies, but the
two libraries do not stay in step.

## Clarifications

No open clarifications. Choices the earlier format left ambiguous are decided under Assumptions and
in the mapping table.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bring a whole library across (Priority: P1)

An author exports their library from the old application, opens AI Book Studio, chooses "Import from
the previous app", selects the file, sees what will be created, and confirms. Every book appears in
the library with its chapters, cast, memories, settings and pictures. A report says what came across
and what did not.

**Why this priority**: Without this, every existing author starts by copying and pasting a book by
hand, which is exactly the loss the new format exists to prevent.

**Independent Test**: Migrate a three-book legacy export into an empty library; all three open, every
chapter's text matches the source byte for byte after normalisation, and the report totals match the
source.

**Acceptance Scenarios**:

1. **Given** a valid library export, **When** the author selects it, **Then** the studio shows the
   books, chapter counts and image counts before writing anything, and writes only after confirmation.
2. **Given** the author confirms, **When** importion finishes, **Then** each book is a folder with
   `book.json` and one Markdown file per chapter, and the library lists them.
3. **Given** a book with 40 chapters, **When** it is imported, **Then** chapter order, titles and
   prologue status match the old book.
4. **Given** the export contains images, **When** importion finishes, **Then** each image is a file in
   the book folder and the cover is marked as the cover.
5. **Given** importion finishes, **When** the author reads the report, **Then** it lists books,
   chapters, words, characters, memories and images imported, plus every skipped item and why.

---

### User Story 2 - Migrate a single book (Priority: P1)

An author only wants one book from a large export, or has a single-book export file. They choose the
book from a list, importe it, and leave the rest alone.

**Why this priority**: The old application offered both exports; authors with several books often
back up one at a time.

**Independent Test**: Migrate one book from a five-book export, then importe the same file again and
confirm the other four were not created and the first was not duplicated.

**Acceptance Scenarios**:

1. **Given** a library export, **When** the author chooses one book, **Then** only that book is written.
2. **Given** a single-book export file, **When** the author imports it, **Then** it is recognised
   without asking which book.
3. **Given** a book was already imported, **When** the same export is imported again, **Then** the
   studio reports it as already present and writes nothing.

---

### User Story 3 - Keep the planning, not just the prose (Priority: P2)

The author's outline, story arc, cast, memories, genre, length target, manuscript settings, front and
back matter and image style arrive with the book, so the Story Bible is populated on first open and
the first export looks like the last one.

**Why this priority**: A imported book that has lost its cast and outline is a manuscript, not a book;
the agent would start from ignorance.

**Independent Test**: Migrate a book with a filled Story Bible and compare every field with the source
export; then export it and compare the settings-driven formatting.

**Acceptance Scenarios**:

1. **Given** a book with characters and memories, **When** it is imported, **Then** every character and
   memory is present with its text and importance.
2. **Given** manuscript settings, **When** the book is imported, **Then** font, size, indent, spacing,
   title alignment, table of contents and line-break preservation match the old settings.
3. **Given** front matter fields (subtitle, author, dedication, disclaimer, about the author), **When**
   the book is imported, **Then** they are present and editable in the new book.
4. **Given** an image style, **When** the book is imported, **Then** the style is set and new
   illustrations can use it.

---

### User Story 4 - Know what did not survive (Priority: P2)

Some old data has no equivalent: browser checkpoints, undo history, tour progress, provider keys,
per-message agent state. The author is told, in plain words, what was left behind and what they can do
about it, instead of discovering a gap months later.

**Why this priority**: The importion is only trustworthy if its limits are visible. Silence is how the
old application lost authors' trust.

**Independent Test**: Migrate a book containing checkpoints and a conversation; confirm the report
names them as not imported, the book opens normally, and the archived conversation file exists.

**Acceptance Scenarios**:

1. **Given** an export with data that has no equivalent, **When** importion finishes, **Then** the
   report names each category and says it was not carried across.
2. **Given** an old conversation, **When** the book is imported, **Then** the transcript is stored as a
   read-only archive inside the book folder and is not replayed as agent history.
3. **Given** an old `modelId`, **When** the book is imported, **Then** the studio records it in the
   report and uses the author's current default model rather than silently calling an unavailable one.

---

### User Story 5 - Survive a bad file (Priority: P2)

The export is truncated, malformed, from another application, or newer than this build. The studio
says so, writes nothing partial into the library, and leaves the original file untouched.

**Why this priority**: Imports are the one place a bug can destroy someone's only backup.

**Independent Test**: Feed the importer a truncated file, a non-export JSON, a newer schema version, and
a book with one damaged chapter; confirm the library is unchanged in the first three and the fourth
importes the good chapters with the bad one reported.

**Acceptance Scenarios**:

1. **Given** a file that is not a recognised export, **When** the author selects it, **Then** the
   studio refuses with a plain explanation and writes nothing.
2. **Given** an export from a newer version, **When** the author selects it, **Then** the studio says
   the file is newer than the app and offers no partial import.
3. **Given** one book in an otherwise valid export is malformed, **When** importion runs, **Then** the
   valid books are imported and the malformed one is reported.
4. **Given** the author cancels during importion, **When** cancellation completes, **Then** books
   already written remain valid, unfinished work is removed, and the report says what was completed.

---

### User Story 6 - Undo the importion (Priority: P3)

The author importes the wrong export or changes their mind. They can remove the books a importion
created, in one action, without touching books that existed before.

**Why this priority**: A one-way door still needs a handle on this side.

**Independent Test**: Run two importions, remove the second by its report, and confirm the first and
its files are untouched.

**Acceptance Scenarios**:

1. **Given** a completed importion, **When** the author chooses "Remove these imported books", **Then**
   exactly those books move to the library trash.
2. **Given** a book was edited after importion, **When** the author removes it, **Then** the studio
   warns that edits will be lost and requires confirmation.

---

### Edge Cases

- Export is the bare browser storage value rather than a wrapped export.
- Export is a single `Book` object rather than a library.
- Export contains `kind: "book"` with one book, or `kind: "library"` with none.
- A book has no scenes but has the legacy whole-book `manuscript` string.
- A book has both scenes and a `manuscript` string, with different text.
- Scenes have duplicate ids, empty titles, missing `draftContent`, or non-sequential order.
- Chapter text contains CRLF, trailing whitespace, YAML-significant leading characters, or a line
  that looks like front matter (`---`).
- Chapter text is empty, huge (100k+ words in one chapter), or contains binary control characters.
- Titles contain slashes, colons, emoji, non-Latin scripts, or are 300 characters long.
- Two books share a title, or a title collides with an existing folder.
- An image entry is missing, has a mismatched MIME type, or is not valid base64.
- An image page points at a version that is not in the image map.
- The export is hundreds of megabytes and the machine has little memory.
- The disk fills or becomes read-only mid-importion.
- The library already contains a book previously imported from the same export.
- The export was produced by a newer schema version.
- The export was produced by a different application that happens to use `books`.

## Requirements *(mandatory)*

### Recognising input

- **FR-001**: The studio MUST accept the previous application's library export, single-book export,
  bare library state, and single book object, and MUST identify which it received.
- **FR-002**: The studio MUST validate the export's application marker and schema version before
  writing anything, and MUST refuse an unrecognised file or one newer than the build.
- **FR-003**: The studio MUST preflight the entire file and present a summary — books, chapters, words,
  characters, memories, images — before the author confirms.
- **FR-004**: The studio MUST show a per-book choice when the file contains more than one book.

### Mapping books

- **FR-005**: The studio MUST create one folder per imported book, using the new book format, and MUST
  record the old book identifier in the new book data.
- **FR-006**: The studio MUST map title, description, genres, explicit-content flag, chapter range,
  outline, story arc and stage, preserving their values.
- **FR-007**: The studio MUST map characters with name, role, description, motivations and notes.
- **FR-008**: The studio MUST map memories with text, importance and timestamps, defaulting a missing
  importance to medium.
- **FR-009**: The studio MUST map manuscript settings exactly, including font, size, indent, spacing,
  title alignment, table of contents and line-break preservation.
- **FR-010**: The studio MUST map front matter fields (subtitle, author name, dedication, disclaimer,
  about the author) into the new book's editable front matter.
- **FR-011**: The studio MUST map the book's image style, cover selection and image page anchors.
- **FR-012**: The studio MUST preserve creation and update timestamps where they parse, and MUST NOT
  invent a newer "updated" time that reorders the library misleadingly.

### Mapping chapters

- **FR-013**: The studio MUST write one Markdown file per scene, in the old scene order, with front
  matter carrying the new chapter id, title, order, arc, purpose, synopsis, notes, prologue flag
  and colour where present.
- **FR-014**: The studio MUST preserve chapter text exactly after canonical newline normalisation:
  paragraph breaks, blank lines inside verse, leading spaces that matter, and the final newline rule of
  the new format.
- **FR-015**: The studio MUST convert a legacy whole-book `manuscript` string into a single chapter
  when the book has no scenes, titled "Manuscript", and MUST warn that it was not divided.
- **FR-016**: When a book has both scenes and a `manuscript` string, the studio MUST use the scenes and
  MUST archive the manuscript string in the book folder rather than discarding it.
- **FR-017**: The studio MUST handle a scene whose `draftContent` is missing by creating an empty
  chapter with its title and planning fields intact.
- **FR-018**: The studio MUST make chapter file names unique and readable, and MUST NOT let a title
  escape the book folder.
- **FR-019**: The studio MUST record a per-chapter old identifier so a re-run can recognise what it
  already wrote.

### Mapping images

- **FR-020**: The studio MUST decode each exported image into a file in the book's image folder, keeping
  its bytes, dimensions, MIME type, source, prompt, model and cost in the book's image data.
- **FR-021**: The studio MUST preserve multiple versions of an image page, marking the old current
  version as current.
- **FR-022**: The studio MUST map image page anchors (front, before chapter, after chapter, back),
  captions and alt text, and MUST rebind chapter anchors to the new chapter identifiers.
- **FR-023**: The studio MUST mark the old cover page as the book cover, including its
  include-in-export setting.
- **FR-024**: The studio MUST report any image referenced but absent, and MUST keep the page with no
  image rather than dropping it.

### Conversations and unsupported data

- **FR-025**: The studio MUST NOT treat an old conversation as agent history, and MUST store it as a
  read-only archive in the book folder when present.
- **FR-026**: The studio MUST NOT importe browser checkpoints, undo records, tour progress, storage
  relief markers, or provider keys, and MUST name them in the report as not imported.
- **FR-027**: The studio MUST report an old model identifier without adopting it as the book's model.

### Safety and idempotency

- **FR-028**: The studio MUST never modify, move or delete the selected export file.
- **FR-029**: The studio MUST write each book into a temporary folder and only publish it into the
  library when complete, so a failed importion leaves no half-book.
- **FR-030**: The studio MUST be idempotent: a second run over the same export MUST NOT duplicate books
  or chapters, and MUST report what it recognised as already imported.
- **FR-031**: The studio MUST proceed past a damaged book or chapter, importing what is valid and
  reporting the rest, unless the whole file is unrecognisable.
- **FR-032**: The studio MUST let the author cancel, leaving completed books valid and removing
  unfinished work.
- **FR-033**: The studio MUST write a machine-readable and human-readable importion report into the
  library's studio folder, listing source file, time, per-book counts, skipped items and warnings.
- **FR-034**: The studio MUST let the author remove the books created by a given importion, moving them
  to trash with confirmation.
- **FR-035**: The studio MUST stream or incrementally parse a large export so memory use stays bounded
  and MUST warn before importing an export above a configured size.
- **FR-036**: The studio MUST handle a full disk or read-only library by aborting cleanly and reporting
  the failure without leaving temporary folders behind.

### Reporting

- **FR-037**: The studio MUST report, per book, the number of chapters, words, characters, memories
  and images written, matching the counts derived from the files it wrote.
- **FR-038**: The studio MUST list every skipped item with its book, kind and reason, in the author's
  words (for example "2 pictures were missing from the file").
- **FR-039**: The studio MUST make the report reachable later from the library, not only in the moment.

### Key Entities

- **Legacy export**: application marker, schema version, kind (library or book), export time, books,
  library metadata, conversation state, image map keyed by image version id.
- **Legacy book**: identity, title, description, genres, explicit flag, chapter range, outline, story
  arc, scenes, characters, memories, stage, manuscript string, model id, manuscript settings, front
  matter, image pages, image style, timestamps.
- **Legacy scene**: identity, title, arc, purpose, synopsis, draft text, draft version, notes, colour,
  prologue flag.
- **Legacy image page**: identity, anchor, caption, alt text, current version, versions, cover flag.
- **Migration report**: source, timestamps, per-book results, skipped items, warnings, created book ids.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of chapter text in a valid export appears in the imported library, with only the
  documented newline normalisation applied.
- **SC-002**: A second importion of the same export creates zero books and zero chapter files.
- **SC-003**: The report's chapter, word, character, memory and image counts match counts derived
  independently from the imported files in 100% of test exports.
- **SC-004**: Every imported image is byte-identical to the image in the export.
- **SC-005**: A representative 250,000-word library importes in under 2 minutes on the reference
  machine with peak memory below 1 GB.
- **SC-006**: No importion failure leaves a partially written book visible in the library in 100% of
  fault-injection runs (full disk, kill mid-run, malformed book).
- **SC-007**: Authors can identify what did not importe without opening a log file, in one screen, for
  100% of tested exports containing unsupported data.
- **SC-008**: Removal of an imported set touches zero books that existed before the importion.
- **SC-009**: The importion completes with no network access.
- **SC-010**: 95% of authors who start a importion finish it without contacting support, measured on
  the first ten real exports used in testing.

## Assumptions

- **One-way**: the studio writes only the new format. The old application is not updated, and there is
  no downgrade path. Authors keep their export file.
- **Source schema**: the earlier app's export, `version: 1` with the wire marker `app: "moms-ai-book-studio"` (and its listed
  legacy application ids) as produced by the last release of that application. A future old-format
  version would need a new spec.
- **IDs**: new identifiers are generated in the new format; old identifiers are retained as
  references, not reused, because the new format's prefixes and file naming differ.
- **Whole-book manuscript**: a book with no scenes but a legacy manuscript string becomes one chapter,
  because arbitrary splitting would guess at chapter boundaries. The author can split it with the
  editor afterwards.
- **Conversation archive**: old conversations are valuable as a record but unsafe as live history, so
  they are archived per book and never replayed.
- **Images**: the export's base64 image map is authoritative; images absent from the map cannot be
  recovered from a browser and are reported, not fabricated.
- **Model choice**: the old `modelId` is not adopted; the author's current default is used, because the
  old identifier may no longer exist or may not support tools.
- **Duplicates**: importion never merges into an existing book. It matches by old identifier to avoid
  duplicates and otherwise creates a new book with a distinguishing suffix.
- **Library location**: importion writes into the currently open library; the author chooses where that
  is before importing.
- **Rollback**: rollback is removal to trash, not a byte-level restore of the pre-importion library.
- **Report location**: reports live in the library's studio folder and are listed in the library
  interface.
