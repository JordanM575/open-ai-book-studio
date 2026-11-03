# Feature Specification: Import a manuscript file

**Feature Branch**: `029-manuscript-import`  
**Status**: Draft / Planned — not implemented  
**Input**: Public product request for general manuscript-file intake, separate from migrating an earlier studio export.

## Current public behavior and proposed behavior

**Present behavior:** Spec [002](../002-studio-v1/spec.md) includes Word import as product intent, but the public roadmap says the general import wizard is missing. The existing `library:importLegacy` journey is the earlier-app JSON migration in [003](../003-earlier-studio-import/spec.md); it is not a general file importer. Portable library archive import in [010](../010-web-target/spec.md) is a separate whole-library transfer into a new or empty destination. DOCX export does not mean DOCX import is available. There is no current public wizard for DOCX, DOC, TXT, RTF or ODT.

**Proposed behavior:** Add a separate, local-only intake journey that turns one supported manuscript file into one new book. The first bounded profile proposed here is desktop UTF-8 TXT/Markdown, with an exact preview of chapter content and boundaries, explicit book/chapter mapping and confirmation, a complete staged book published as one unit, a result report, and safe cancel/failure behavior. This profile is a proposal, not an accepted format, size or platform decision. The public long-term intent remains DOCX, DOC, TXT, RTF and ODT; the formats and targets outside the first profile are explicitly deferred below.

This spec expands 002 FR-035. It does not change the earlier-app migration in 003, the portable archive in 010, or the book format in `docs/FORMAT.md`.

## Overview

An author has a manuscript in an ordinary document file and wants to start working with it in AI Book Studio. They choose one file, review how its text will become a new book and its chapters, edit the proposed book and chapter titles, and confirm. Until confirmation, nothing is written to the library. After confirmation, the studio publishes either the complete new book or no visible book at all. The source file is never modified.

The first profile treats TXT and Markdown as text, not as a source of Story Bible data. It performs no model call, enrichment, provider request, or silent prose rewrite. The author sees the exact normalized chapter bodies that will be saved before confirming.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Bring one manuscript into a new book (Priority: P1)

An author chooses one supported manuscript file from the desktop app, reviews a proposed new book, and confirms. The book appears in the current library with the chapters and text shown in the preview.

**Why this priority**: An author needs a safe path from an existing manuscript to the ordinary book files the studio edits. A single-file, single-book import bounds the first delivery and keeps it distinct from library migration.

**Independent Test**: With a synthetic UTF-8 fixture in an isolated temporary directory, import one file into an isolated temporary library. Compare the opened book's chapter bodies with the exact preview, verify one new book was added, and verify the source bytes and all pre-existing library files are unchanged.

**Acceptance Scenarios**:

1. **Given** the author opens the import action, **When** the native file picker is shown, **Then** it identifies the proposed first-profile extensions and explains that unsupported formats are not accepted by this build.
2. **Given** the author selects a valid UTF-8 `.txt`, `.md` or `.markdown` file, **When** the file is read, **Then** the studio proposes exactly one new book and never changes the selected source.
3. **Given** a supported file, **When** the preview opens, **Then** the author can review the full chapter text, chapter order and split boundaries that would be saved, and can edit the proposed book title and each chapter title.
4. **Given** the author changes a split point, **When** the preview refreshes, **Then** every nonblank source line remains in exactly one chapter body, the changed boundaries are visible, and any edge blank lines removed by the canonical format rules are identified; the displayed chapter text is the text that confirmation will write.
5. **Given** the author has reviewed the mapping, **When** they confirm, **Then** one complete new book is published in the open library and is immediately available in its book list.
6. **Given** the author declines, dismisses the picker, or cancels preview, **When** the journey ends, **Then** no book, chapter, report file or source-file change is created.

### User Story 2 — Know what will and will not be imported (Priority: P1)

The author sees a clear mapping before writing: the selected file becomes one book, its text becomes one or more chapters, and title fields are explicit. The studio does not imply that it has recovered planning data or other document features that the first profile does not map.

**Why this priority**: An import is trustworthy only when the author can see what the app will create and what it will leave alone.

**Independent Test**: Use synthetic TXT and Markdown fixtures containing headings, blank lines, Unicode, and Markdown syntax. Confirm the preview and final report name the same book, ordered chapters, word counts and normalization, with no nonblank source text omitted, duplicated or provider-generated.

**Acceptance Scenarios**:

1. **Given** a file name such as `The Long Road.md`, **When** the preview opens, **Then** the proposed book title is editable and is not treated as trusted book metadata.
2. **Given** the source contains Markdown headings or front-matter-like text, **When** the preview opens, **Then** those characters remain manuscript text in this profile; the studio does not silently parse them as AI Book Studio metadata.
3. **Given** the author confirms an import, **When** the result is shown, **Then** the report names the source file by its display name, the created book title, chapter count, word count, split mapping and any text normalization; it says that no Story Bible, images or other document metadata were imported.
4. **Given** the selected extension is not in the first profile, **When** the author tries to select or open it, **Then** the studio refuses before writing and names the supported extensions for this build.
5. **Given** a file cannot be decoded as supported UTF-8 text or exceeds the accepted input limit, **When** it is checked, **Then** the studio explains the specific reason and suggests choosing a supported text file or a smaller file; it does not truncate or guess an encoding.

### User Story 3 — Cancel or recover without a partial book (Priority: P1)

The author can stop before publication. If reading, staging, validation or writing fails, the source remains untouched and no incomplete book is shown as imported. If the author asks to cancel once publication has reached its atomic commit point, the studio says that it is finishing the commit rather than claiming the operation stopped.

**Why this priority**: The manuscript may be the author's only copy. The importer must not turn a failed operation into an incomplete or misleadingly successful book.

**Independent Test**: Use an in-memory library port and isolated temporary desktop-library fixtures with injected read, write, move, cancellation and cleanup failures. At every pre-publication failure point, verify that existing books are unchanged, no incomplete book is listed, and the source bytes are unchanged.

**Acceptance Scenarios**:

1. **Given** the author cancels while the importer is reading or staging, **When** cancellation completes before publication, **Then** the staging content is removed, no new book appears, and the report says the import was cancelled before publication.
2. **Given** the author cancels while the final atomic publish is in progress, **When** the commit returns, **Then** the UI reports the actual result—complete book published or no book published—and never reports a cancelled import that left a book behind.
3. **Given** a staging write or final publish fails, **When** the operation stops, **Then** existing books and source bytes remain unchanged, the incomplete book is not listed, and the author sees what failed and a safe next action.
4. **Given** the app cannot remove its own staging data after a failure, **When** the error is shown, **Then** the report says that unpublished staging data remains, identifies a safe cleanup action, and does not claim the import succeeded.
5. **Given** publication succeeds but the derived library catalog cannot refresh, **When** the result is shown, **Then** the book is still reported as imported because its complete source files were published; catalog refresh is described as recoverable and does not cause a duplicate retry.

## Edge Cases

- The author cancels the native file picker or selects a file that disappears before it can be read.
- The file has a UTF-8 BOM, invalid UTF-8, NUL bytes, unsupported control characters, or line endings other than LF.
- The file is empty, contains only whitespace, has very long lines, or has no final newline.
- Markdown contains headings, fenced code, YAML-looking front matter or repeated title text; the first profile must not reinterpret it silently.
- A proposed split would create an empty chapter, or a boundary falls next to blank lines.
- The filename is empty after extension removal, contains unusual Unicode, or is longer than a safe display title.
- The selected file exceeds the accepted size limit or contains more lines/segments than the accepted limits.
- The library is read-only, the disk fills, the library folder disappears, or a sync tool changes library files while the book is staged.
- The generated book identity or staging path already exists.
- The author closes the app during staging or immediately after publication.
- A stage cleanup fails, an atomic directory move is not supported by a target, or the catalog refresh fails after publication.
- The same source file is imported again. Each confirmed run is a new-book request; it never updates or silently deduplicates an existing book.

## Requirements *(mandatory)*

### Current behavior and boundaries

- **FR-001**: The studio MUST keep this journey separate from the earlier-app JSON migration in spec 003 and the portable library archive import in spec 010. It MUST NOT call the legacy importer or reuse its multi-book selection, partial-completion or cancellation contract.
- **FR-002**: The first profile MUST handle one selected manuscript file per run and create at most one new book. It MUST NOT merge into, replace, or update an existing book.
- **FR-003**: A build MUST NOT present a draft or planned import capability as present behavior. Any shipped import entry point MUST identify only the formats and platforms actually enabled and verified in that build.

### Proposed first-profile input

- **FR-004**: The proposed first profile MUST be limited to desktop UTF-8 plain text and Markdown files (`.txt`, `.md`, `.markdown`). The supported desktop operating-system matrix remains open; macOS is the public reference target in spec 013, not proof that this importer is available on every platform.
- **FR-005**: The proposed first profile MUST reject DOCX, DOC, RTF and ODT, as well as PDF, EPUB, JSON and other unsupported inputs, with an actionable message. Support for DOCX, DOC, TXT, RTF and ODT remains the long-term public intent; only TXT/Markdown is proposed for the bounded first profile.
- **FR-006**: The proposed first profile MUST decode UTF-8 strictly, with any BOM, invalid-byte, control-character, empty-input and size-limit behavior stated before implementation. It MUST reject unsupported input rather than silently guessing an encoding, dropping data or truncating text.
- **FR-007**: The desktop main process MUST obtain the source through a user-initiated file picker and read it locally. The renderer MUST NOT supply a trusted host path or access the filesystem directly.
- **FR-008**: Import MUST work without a network connection. It MUST NOT call an enrichment service, model provider, or other external service, and MUST NOT create Story Bible content, images, model state or credentials.

### Proposed preview and mapping

- **FR-009**: Before any library write, the studio MUST show an exact preview of the complete normalized chapter bodies, their order and boundaries, plus the proposed book and chapter titles.
- **FR-010**: The proposed default MUST be one chapter containing the whole file. The author MUST be able to add or remove split points only between source lines and edit every resulting chapter title. The preview MUST show which lines belong to each chapter; every nonblank source line MUST appear exactly once, and any blank lines removed by canonical body rules MUST be identified rather than silently omitted.
- **FR-011**: The author MUST explicitly confirm the mapping from the one source file to one new book and its ordered chapters. Dismissing the preview or choosing cancel MUST leave the library unchanged.
- **FR-012**: For Markdown, the proposed first profile MUST treat headings, YAML-looking front matter and all other Markdown syntax as literal manuscript text. It MUST NOT infer Story Bible fields or silently strip heading lines to use as chapter titles.
- **FR-013**: Imported chapter bodies MUST use the canonical body rules in `docs/FORMAT.md`: CRLF and CR become LF; leading and trailing blank lines are removed per chapter; no other whitespace, punctuation or Markdown rewriting is performed; the saved file ends with the format's single final newline. The exact result MUST be visible before confirmation.
- **FR-014**: Book and chapter titles MUST be editable before confirmation. The book title MAY default from the source basename, but file metadata MUST NOT be treated as confirmed author intent.

### Staging, publication and recovery

- **FR-015**: The importer MUST stage a complete new book, including `book.json` and every chapter file, before making it visible under `books/`. It MUST validate and read back the staged files before publication.
- **FR-016**: The importer MUST publish a complete staged book as one atomic directory operation on the supported first-profile target. If the target cannot provide that guarantee, it MUST refuse publication rather than expose a partial book.
- **FR-017**: Until publication succeeds, the importer MUST leave all pre-existing books and library files unchanged, apart from its own unpublished staging data. A failed or cancelled import MUST NOT create a book-list entry.
- **FR-018**: Cancellation MUST be available before the publication commit point. The UI MUST make clear when the final atomic commit is non-cancellable, wait for the real result, and report success or failure truthfully.
- **FR-019**: On cancellation or failure before publication, the importer MUST remove its own staging files. If cleanup fails, it MUST retain them only as unpublished staging data, report that fact and offer a safe recovery action; it MUST NOT report a completed import.
- **FR-020**: A successful publication MUST use a new book identity and MUST NOT overwrite a destination with the same identity. A repeated import of the same source is a separate, explicitly confirmed new-book request; no title- or content-based deduplication is implied.
- **FR-021**: The original source MUST remain unchanged on success, cancellation and failure.

### Reporting and honest platform support

- **FR-022**: For every import operation that has started, the author MUST receive a human-readable result after completion, cancellation or failure that distinguishes published, cancelled-before-publication and failed-before-publication outcomes. A successful report MUST include the display filename, book title, chapter count, word count, split mapping and normalization applied.
- **FR-023**: The report MUST state that planning data, images and other document metadata were not imported by the first profile. It MUST NOT include the full host path unless a future privacy decision explicitly requires it.
- **FR-024**: The first profile MUST be exposed only on desktop targets whose picker, file-read, path-safety and atomic-publication behavior has passed its conformance checks. Web, iOS and Android availability MUST NOT be implied. Windows and Linux availability remains undecided until the platform decision and checks are complete.
- **FR-025**: The library's derived catalog MAY refresh after publication. A catalog refresh failure MUST NOT undo or misreport a complete book publication; reopening the library MUST be able to rediscover the book from its ordinary files.

## Non-Goals

- Migrating an earlier AI Book Studio export, selecting multiple books, preserving legacy state, or undoing a batch migration; spec 003 owns that journey.
- Importing a portable library archive; spec 010 owns that transfer.
- DOCX, DOC, RTF or ODT parsing in the first profile, including any claim that Word export supports Word import.
- Browser, iOS or Android file selection and publication in the first profile.
- Automatic chapter detection, semantic restructuring, title inference beyond an editable filename-based default, or automatic Markdown metadata parsing in the first profile.
- Creating, enriching or summarizing a Story Bible, images, settings, outline, cast, memories, or agent context.
- Any provider, AI, account, server, telemetry or network use.
- Changing the library format, canonical Markdown rules, sync policy, or general portable archive semantics.

## Key Entities

- **Source file**: one author-selected local TXT or Markdown file, read without mutation.
- **Import preview**: the exact proposed book title, ordered chapter titles, split boundaries, normalized chapter text and summary shown before confirmation.
- **Staged book**: a complete unpublished set of ordinary book files in library-owned temporary storage.
- **Published import**: one complete new book moved into the library's `books/` tree as a single commit.
- **Import report**: the author-visible outcome and counts for this one run, including normalization and any cleanup warning.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In 100% of synthetic supported-file tests, every nonblank non-boundary source line appears in exactly one chapter preview, canonical edge-blank removal is identified, and the committed chapter bodies equal the preview after the documented canonicalization.
- **SC-002**: In 100% of confirmation tests, the book title, chapter titles, order and split points written to the isolated library match the author's final preview.
- **SC-003**: In 100% of injected pre-publication read, validation, staging, disk-full and cancellation failures, no incomplete book is listed and no pre-existing library file or source byte changes.
- **SC-004**: In 100% of publication fault tests, the result is either one complete new book or no visible new book; there is no partial published book.
- **SC-005**: Every supported/unsupported extension, encoding failure and configured input-limit failure produces an actionable explanation before publication, with no silent truncation or encoding guess.
- **SC-006**: The result report's chapter and word counts match values derived independently from the published files in every synthetic fixture test.
- **SC-007**: Automated checks for this feature use synthetic isolated fixtures and make no provider, network, real-manuscript, credential or device access.

## Assumptions and Unresolved Decisions

### Proposed assumptions — not accepted decisions

- One source file produces one new book; import never merges into an existing book.
- The bounded first profile is desktop UTF-8 TXT/Markdown, with a whole-file one-chapter default and author-controlled line-boundary splits.
- Markdown syntax remains literal body content in the bounded first profile.
- The new-book directory is staged inside the chosen library and becomes visible only after one atomic directory publication.
- The first report is shown in the result view for the current import run. Durable import-history storage is not promised by this spec.
- Format normalization follows the already-public canonical body rules in `docs/FORMAT.md`; no smart-quote conversion, paragraph inference or prose cleanup is implied.

### Unresolved decisions

1. **Split and title behavior — decided 2026-11-03 with the author**: the proposal stands — whole file as one chapter by default, author-selected line-boundary splits, Markdown literal, filename-derived editable book-title default. Implemented in T005 (`packages/core/src/manuscript-import/`).
2. **Input safety limits — decided 2026-11-03 with the author**: 5 MiB maximum source (conservative against proven 15 MiB IPC round-trips), strict UTF-8, strip exactly one leading BOM, reject NUL/control characters except tab/LF/CR, refuse empty input. Implemented in T005 (`MAX_SOURCE_BYTES`).
3. **Atomic publication contract — verified 2026-11-03**: the desktop adapter publishes a complete staged directory with one same-filesystem rename (atomic on the macOS reference target); cross-device moves are refused with `unsupported` instead of copying; `removeDirectory` was added to the port for unpublished staging cleanup. Web copy+delete does not qualify, so the first profile's publisher stays desktop-gated per FR-024. Conformance covered by `packages/core/tests/library-port.test.ts` and `apps/desktop/tests/library-publish.test.ts`.
4. **Desktop platform matrix — decided 2026-11-03**: macOS-only initial. Only the macOS reference target has verified native behavior (atomic same-filesystem rename per T003, native open dialog and staging per T008 tests); Windows and Linux stay disabled until their rename, dialog and staging behavior is verified the same way. This blocks enabling the capability on an unverified platform, not pure parser work.

Each decision remains open until recorded in the public decision process. The proposed first-profile bounds in this draft must not be represented as accepted public decisions before that happens.
