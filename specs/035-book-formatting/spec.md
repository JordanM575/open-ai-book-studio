# Book formatting and export

**Status:** Draft / Planned — Phase 1 (T001–T003: Format journey design, approximate-preview surface, UI contract tests) is implemented; ordered matter, renderer selection and remaining export work are not started.
**Number:** 035
**Depends on:** [002 — AI Book Studio v1](../002-studio-v1/spec.md), [019 — Illustrations](../019-illustrations/spec.md), and the public file-format contract in [`docs/FORMAT.md`](../../docs/FORMAT.md).

## Why

An author needs to shape a saved book for different reading and publishing formats without turning the
export into a second manuscript. The author should be able to edit a book-format model, inspect an
honestly labelled preview, arrange front and back matter, and export a copy while the Markdown source
and image files remain theirs and unchanged.

Spec 002 calls for DOCX, PDF, EPUB and Markdown exports, editable ordered front and back matter, and
formatting settings. The public runtime currently provides DOCX export and a canonical set of
typography settings. This spec defines the separate formatting journey; it does not claim that the
other formats, print measurements or publisher-ready output exist today.

## Present public behavior

- The workspace flushes the open editor before requesting DOCX export. The main process reads the
  saved book through `Library`, builds a DOCX, and writes the chosen destination atomically.
- The DOCX builder uses `settings.manuscript` for body font, font size, first-line indent, line
  spacing, and chapter-title alignment. It includes a title/description page and separates chapters.
  The current output is not an in-app visual preview.
- The book schema already has `settings.manuscript`, which also contains table-of-contents and
  line-break options. This spec does not claim that every existing option is currently represented in
  the DOCX output.
- `book.frontMatter` is currently a free-form record keyed by string IDs. It is not an ordered
  sequence and the current DOCX builder does not use it as ordered matter.
- Spec 019 owns the `images.json` manifest, image files and chapter attachments. The current DOCX
  path can read attached illustrations. This spec consumes those existing attachments for output; it
  does not add image management or generation.
- PDF, EPUB and Markdown manuscript export are not currently available.

## User stories

### 1. Set a format and inspect an honest preview

As an author, I choose an output format, adjust the supported book typography in one place, and see a
local preview before exporting. The preview tells me that it is approximate and does not imply exact
page breaks, a measured trim size, or compatibility with a publisher.

### 2. Arrange front and back matter

As an author, I add, edit and reorder front-matter and back-matter sections independently. I can start
from editable templates, and the order I see is the order requested for export. Existing book data is
not silently converted or discarded.

### 3. Export a saved version safely

As an author, I choose DOCX, PDF, EPUB or a folder of Markdown and a destination. The export is made
from a saved snapshot, leaves the library source untouched, and tells me what was written. If saving,
rendering, writing or publishing fails—or I cancel—the studio explains what happened and does not
replace a previous export with a partial one.

## Requirements

### Format model and editor

- **FR-001** The format model MUST distinguish the requested output target (`DOCX`, `PDF`, `EPUB`, or
  `Markdown`) from the saved book source. It MUST be a read-only projection for rendering, not a second
  editable copy of chapter prose.
- **FR-002** The editor MUST read and write the existing `settings.manuscript` typography fields as
  their single canonical source. It MUST NOT create duplicate font, font-size, indent, line-spacing or
  chapter-title-alignment settings in a separate format profile.
- **FR-003** The editor MUST show which target is selected and which options are supported for it.
  A target without an implemented renderer MUST be labelled unavailable or planned; it MUST NOT
  appear to export successfully.
- **FR-004** The local preview MUST remain visibly labelled **Approximate preview** while displayed
  and state that final output can differ in the target reader or word processor. It MUST NOT present
  measured pagination, guaranteed page breaks, exact page counts, trim measurements or printer
  compatibility as facts.
- **FR-005** The preview MUST update when the author changes a supported typography setting or matter
  order. It MUST be local-only; previewing MUST NOT call a provider or modify the source book.
- **FR-006** Formatting controls MUST be keyboard operable, use the existing design tokens and provide
  visible focus and sentence-case labels. Preview disclosure MUST not depend on hover or color alone.

### Ordered matter and compatibility

- **FR-007** The proposed book format MUST add a versioned ordered-matter value to `book.json`, separate
  from the existing `frontMatter` record. The additive value MUST represent ordered front sections and
  ordered back sections, with stable section IDs, editable titles and content, and a section kind for
  built-in templates. The export sequence MUST be front sections, chapters in chapter order, then back
  sections. The exact field name and migration contract remain subject to the open decision below.
- **FR-008** The author MUST be able to add, edit, reorder and remove sections in each side. Removing a
  section MUST require confirmation before its saved content is removed. Reordering MUST be available
  without a pointer.
- **FR-009** Built-in disclaimer and other matter templates MUST be editable starting text. Selecting a
  template MUST create author-owned section content; later template changes MUST NOT overwrite it.
  Template copy MUST not claim legal advice or guarantee publisher acceptance.
- **FR-010** The studio MUST preserve the current `frontMatter` record as-is until a public legacy
  conversion decision is accepted. It MUST NOT enumerate that record as if it were an ordered list,
  infer front/back placement, or silently migrate or delete it.
- **FR-011** Until a legacy conversion path is accepted and available, a book with a non-empty legacy
  `frontMatter` record MUST receive an export preflight notice that the record is not included in the
  ordered export. The author MUST be able to cancel or explicitly continue without those legacy
  values. The stored record MUST remain unchanged.
- **FR-012** Existing books without the additive matter value MUST continue to open. Adding ordered
  matter MUST be backward-compatible and MUST preserve unknown book fields.

### Saved-source export

- **FR-013** Before export, the workspace MUST flush pending editor input. If the save fails, conflicts
  with another writer, or is cancelled, export MUST not start; the author MUST see the save outcome and
  retain the draft for recovery or conflict review.
- **FR-014** The main process MUST build an immutable export snapshot from saved library data after the
  flush succeeds. A render MUST use that snapshot rather than rereading or mutating manuscript files
  partway through the export.
- **FR-015** Export MUST leave `book.json`, chapter Markdown, the image manifest and stored image bytes
  unchanged. The main process MUST be the only writer to any export destination; the renderer MUST NOT
  supply an unchecked filesystem path.
- **FR-016** The destination MUST NOT alias a source file or replace the active book's managed source
  directory. If a chosen target resolves to a source path, the export MUST stop before writing and tell
  the author to choose another destination.
- **FR-017** A destination that already exists MUST be replaced only after the author confirms. The
  exporter MUST detect if that destination changes before publication and preserve the newer bytes
  rather than overwriting them silently.
- **FR-018** Single-file exports MUST be staged before publication. A Markdown folder export MUST be
  assembled in a sibling staging directory before publication. On render, write, rename or publish
  failure, the previous destination MUST remain intact and temporary output MUST be cleaned up where
  possible; any cleanup failure MUST identify the remaining temporary path.
- **FR-019** Cancelling the destination picker MUST leave the source and any prior export unchanged.
  Cancelling an active export MUST stop before publication, clean up staging output, and return the UI
  to an available state. A completed publication MUST be reported as complete, not as cancelled.
- **FR-020** On success, the studio MUST identify the destination and target format. If the source
  changes after the snapshot is captured, the export MUST still represent that snapshot and the success
  notice MUST identify it as the saved version captured when export began.
- **FR-021** Markdown export MUST produce an ordinary folder of readable Markdown files in book order,
  including ordered matter once supported. It MUST not mutate or replace the source chapter files.
- **FR-022** Export MUST work offline and MUST NOT send manuscript content or images to a studio
  service, telemetry endpoint or model provider.

### Illustration boundary

- **FR-023** Export MUST resolve images only through the existing spec 019 image store and attachment
  records. It MUST NOT add a second image manifest or embed image bytes in `book.json`.
- **FR-024** Export MUST copy or embed attached image data into the chosen output as required by the
  output target; it MUST never move, rename, re-encode or delete the source image. A missing or
  unreadable optional image MUST produce an author-visible warning while preserving the text export.
- **FR-025** This spec MUST NOT change image generation, attachment, replacement, deletion, provenance
  or gallery behavior. The format journey owns only how an already attached image is consumed by a
  renderer.

Spec 002 also states that illustrations should follow book order, have their own page in paged exports,
and be accompanied by separate image files. Those are output-packaging requirements, not changes to
spec 019's storage or attachment behavior. Their per-target implementation and acceptance remain
unresolved with D-108; this spec makes no claim about actual pagination.

## Acceptance scenarios

1. **Given** a book with existing typography settings, **when** the author opens Format, **then** each
   typography value comes from `settings.manuscript`, and editing it does not create a second copy.
2. **Given** any preview, **when** it is shown, **then** it says **Approximate preview** and explains
   that final output may differ; no page count, measured trim size or publisher-readiness badge appears.
3. **Given** front and back matter sections, **when** the author reorders them and reopens the book,
   **then** each side retains the chosen order and the preview reflects it.
4. **Given** a book with a non-empty legacy `frontMatter` record, **when** the author exports before
   conversion support exists, **then** the preflight names the excluded legacy values and offers
   **Continue without them** or **Cancel**; the record remains byte-for-byte unchanged.
5. **Given** an unsaved editor draft, **when** the author starts export, **then** the workspace flushes
   first; a save failure or conflict prevents export and leaves the draft available.
6. **Given** a synthetic book in an isolated temporary library, **when** export succeeds, **then** the
   output reflects the captured saved snapshot and source hashes are unchanged.
7. **Given** a previous export at the chosen destination, **when** rendering or publication fails or is
   cancelled, **then** the previous bytes remain intact and the author sees a useful next step.
8. **Given** an output path that aliases a book source path, **when** export begins, **then** no source
   or output file is replaced and the author is asked to choose another destination.
9. **Given** an attached image that is missing or unreadable, **when** an export runs, **then** the
   author sees which optional image was skipped and the manuscript text remains exportable.
10. **Given** a destination the author cancels in the picker, **when** the picker closes, **then** no
    file is written and the workspace is usable again.

## Success criteria

- **SC-001** In synthetic isolated-library tests, every supported export preserves the source book and
  chapter hashes, and every injected failure/cancel before publication leaves an existing destination
  unchanged.
- **SC-002** In synthetic fixtures, front and back matter order survives save, reload and export with
  no silent conversion from the legacy record.
- **SC-003** In UI checks, every preview state displays the approximate-preview disclosure, and every
  format control is reachable and operable by keyboard alone.
- **SC-004** An export error or cancellation returns the workspace to an actionable state and never
  reports success for an output that was not published.

## Open decisions and limits

- **D-108 — export libraries and determinism is Proposed, awaiting author acceptance**
  (`research/export-renderers.md`). No renderer is selected and no deterministic output is claimed
  until the decision is accepted. It must also reconcile spec 002's image-order, own-page and
  separate-image-folder requirements with the output contract for each target. It blocks renderer
  selection, per-target image placement/packaging and conformance tasks only; it does not block
  editor design, the clearly approximate preview, or tests and safety work around the current DOCX
  path. Do not claim KDP/KDP Print or Kindle Unlimited eligibility, print measurement, exact
  pagination, or publisher readiness.
- **Ordered matter and legacy conversion — D-169 Proposed, awaiting author acceptance**
  (`research/matter-schema.md`). The proposal: kind as a pure function of the key, an additive
  `matterOrder` field with a deterministic fallback, order-only conversion with explicit
  confirmation, clear-to-rollback, and tolerant carry for unreadable records. No conversion
  behavior is assumed until the decision is accepted.
- **Format profiles and physical-layout options — D-170 Proposed, awaiting author acceptance**
  (`research/format-profiles.md`). The proposal: transient per-export choices defaulting to the
  canonical manuscript, a reserved additive top-level `formatProfiles` shape for when a renderer
  consumes target-specific values, and zero physical-layout controls until D-108 renderer
  acceptance. No profile persists and no measurement is modeled until the decision is accepted.
- **D-115 is about release signing and updates, not export.** It neither approves a renderer nor gates
  this export feature.

## Non-goals

- Editing manuscript prose or chapter order from the Format journey.
- Image generation, image editing, attachment management or a second image-storage system.
- Selecting an export engine or making an output determinism, print-measurement, pagination,
  KDP/KDP Print, Kindle Unlimited or publisher-acceptance claim before the applicable public decision.
- A guarantee that an export looks identical across Word processors, PDF readers, e-readers or printers.
- Library archive export/import, release signing, notarisation or application updates.
