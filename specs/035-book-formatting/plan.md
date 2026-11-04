# Plan: book formatting and export

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)
**Status:** Draft / Planned. This plan records intended work only; no implementation or acceptance is claimed.

## Constraints

- Preserve the public local-first architecture: the main process reads and writes files through
  `Library`; the renderer uses the validated preload/IPC surface and never receives filesystem access.
- Treat saved Markdown and book files as canonical. Rendering is a read-only projection of a saved
  snapshot; output is a separate copy.
- Reuse `book.settings.manuscript` for canonical typography. Do not add a parallel set of typography
  values to an export profile.
- Keep the existing `book.frontMatter` record intact and semantically unchanged. Any ordered matter
  field is additive, versioned and dependent on the unresolved public conversion decision.
- Reuse spec 019's image store and attachment records. This feature reads attached images for output;
  it does not modify their lifecycle.
- Use only synthetic, isolated library fixtures for tests in this feature. Live manuscripts,
  credentials, providers and paid services are not test inputs.

## Proposed architecture

### 1. Read-only export model

Introduce a pure export projection after a save succeeds. Its inputs are the saved `BookDetail`,
`settings.manuscript`, the proposed ordered-matter value when available, and attachment references
resolved through the image store. Its output is a stable in-memory snapshot containing the selected
target, book metadata, ordered matter, chapter IDs/titles/order/Markdown, canonical typography, and
attached image bytes or explicit missing-image warnings. It contains no mutable filesystem paths from
the renderer and no second copy of typography state.

The snapshot is captured once. Every renderer uses that same snapshot even if a later save occurs. The
success message identifies that it represents the saved version captured when export began.

### 2. Additive matter schema — decision required first

The working proposal is a new versioned `orderedMatter` value in `book.json`, separate from
`frontMatter`, with ordered `front` and `back` arrays. A section would have a stable ID, kind, title and
editable Markdown content. Array order is the displayed order. This is a proposal, not an accepted
schema: field naming, section details and treatment of populated legacy records must be resolved and
recorded publicly before schema or conversion code is written.

The legacy record must never be cast to an array or automatically assigned a side or order. Existing
books continue to open with no new value. Until conversion is decided and implemented, the export
preflight warns that non-empty legacy values are excluded and requires the author to continue
explicitly or cancel.

### 3. Format editor and approximate preview

Add a Format journey in the shared app shell. The editor presents target selection and the currently
supported canonical typography controls. Target-specific physical-layout settings remain absent until
the format-profile decision is accepted. The preview is rendered locally from the projection, stays
visibly labelled **Approximate preview**, and states that final appearance can differ. It must not
simulate or report measured pages, print trim or publisher eligibility.

Use the existing design tokens and keyboard patterns. Keep the preview separate from the manuscript
editor and the spec 019 illustration management UI.

### 4. Export boundary and safe publication

The workspace flushes pending editor input before it requests an export. A failed or conflicted save
stops the operation and preserves the draft. Main-process code then reads the saved book and attached
image records through `Library`, captures the export snapshot and renders from it.

The main process obtains the destination through a native picker or a separately validated destination
contract. It rejects source-path aliases before creating output. Existing output requires explicit
replacement consent and a pre-publication recheck. Single-file output is staged and atomically
published. Markdown folder output is assembled in a sibling staging directory before a safe directory
publication. Cancellation and failures remove staging output when possible and preserve any previous
destination. Cleanup failures identify the remaining temporary path.

The workspace reports the chosen destination and selected format only after publication succeeds.
Cancel, failure, missing optional images and an unconverted legacy matter record have distinct,
author-readable states.

### 5. Renderer strategy

Keep a renderer seam keyed by the selected format, but do not choose or add a DOCX/PDF/EPUB library in
this spec. D-108 must be researched and resolved before renderer selection or conformance claims for
those formats. Markdown output can be planned independently, but its packaging and matter behavior
still depend on the public matter decision. Until renderers exist, unsupported targets are visibly
unavailable rather than represented as complete.

D-108 was accepted on 2026-11-03 and the renderers now exist: `manuscript-html.ts` and `pdf.ts`
(Chromium print-to-PDF in a hidden window) and `epub.ts` (`fflate`), all in `apps/desktop/src/main`,
behind `exportManuscriptPdf` and `exportManuscriptEpub` in `export.ts`. They read the same saved
`BookDetail` and the same collected illustrations as DOCX; no export-model package was added.

## Likely files in a future implementation

These paths are planning references, not files changed by this authoring task.

```text
packages/core/src/schema.ts                   additive ordered-matter schema after decision
packages/core/src/export/model.ts              target and read-only snapshot types
packages/core/src/export/index.ts               pure export projection and validation
packages/core/tests/export/                     synthetic model and format-contract tests
packages/app/src/views/FormatView.tsx            editor and target selection
packages/app/src/components/FormatPreview.tsx    labelled approximate local preview
packages/app/src/views/WorkspaceView.tsx         flush, navigation and export status
apps/desktop/src/main/export.ts                  renderer seam and staged publication
apps/desktop/src/main/ipc.ts                     validated export requests and destination flow
apps/desktop/src/preload/index.ts                narrow export methods
apps/desktop/tests/export/                       isolated library and failure-path tests
docs/FORMAT.md                                  public file-format change after schema acceptance
docs/DECISIONS.md and docs/adr/                 public decision record when accepted
```

Exact module names may follow the repository structure when implementation begins. No schema,
renderer library or destination behavior is considered accepted by this file alone.

## Decision gates

| Decision | Needed before | Does not block |
| --- | --- | --- |
| D-108: renderer choices, deterministic-output scope and per-target illustration packaging | Selecting or adding DOCX/PDF/EPUB renderers; illustration placement/sidecar packaging; any output-conformance claim | Editor design, approximate preview, synthetic UI tests, image reads through spec 019, and characterization/safety work for the existing DOCX path |
| Ordered-matter schema and legacy conversion | Persisted schema, conversion UI, ordered-matter export | Editor shell, preview disclosure, canonical typography controls, current DOCX safety work |
| Format-profile persistence and physical-layout options | Persisting target-specific settings or exposing physical-size controls | Existing typography controls and format-target selection |

Each decision is a scoped gate. An unresolved decision does not stop unrelated editor or safety work.
D-115 is limited to release signing and updates and is not an export dependency.

## Verification approach

- Pure tests use synthetic saved books and image attachments in isolated temporary libraries.
- UI tests cover target availability, canonical typography binding, persistent approximate-preview copy,
  keyboard reordering, save/cancel/error states and no false success.
- Export boundary tests assert source hashes and bytes remain unchanged; source-path alias rejection;
  destination replacement consent and recheck; and previous-output preservation on injected render,
  write, rename, cancellation and cleanup failures.
- DOCX tests first characterize only current public behavior and the safe saved-source contract. They
  do not assert publisher acceptance or exact pagination.
- PDF and EPUB tests and renderer selection wait for D-108. Matter tests wait for the schema and legacy
  conversion decision. All test books and image bytes are synthetic; no live provider or real manuscript
  is used.
- After implementation, update `docs/FORMAT.md` with any accepted on-disk schema and the applicable
  public decision/ADR. This authoring task does not edit those files.
