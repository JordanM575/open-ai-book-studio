# Tasks: illustrations

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — Format and store

- [x] T001 Add `packages/core/src/images/schema.ts`: image record, `images.json` version 1, format and
  dimension detection for PNG/WebP/JPEG, size and prompt limits, and a typed manifest parse result.
- [x] T002 Add `packages/core/src/images/store.ts` over `LibraryPort`: read manifest, list images,
  read bytes, add a generated/imported image atomically, attach to a chapter, delete to the library
  trash. Tests cover corrupt/future manifests, a failed manifest write and an orphan file.
- [x] T003 Wire the image store into `Library`/`Studio`, add `image:list`, `image:read`,
  `image:generate` and `image:attach` IPC channels with Zod validation and preload types.

## Phase 2 — Muse Image

- [x] T004 Add `apps/desktop/src/main/images.ts`: Meta connection selection, `muse-image-1.0` request,
  base64 decode, image inspection, cost/provenance, timeout and normalized errors. Tests use a mocked
  fetch for success, refusal, auth, rate limit and malformed payload.
- [x] T005 Connect the service to the image store so a successful generation writes the file and
  manifest in one operation. A failed write must not leave a record.

## Phase 3 — Interface and export

- [x] T006 Add `IllustrationDialog` with prompt, size, model, estimated cost, Generate, preview,
  Attach, Regenerate and the no-connection/refused/failed states. Render the attached image in the
  workspace.
- [x] T007 Add the attached image to DOCX export with a caption; a missing file warns and does not fail
  the export.
- [x] T008 Include `images.json` and `images/` in archive export/import tests, and add the format
  section to `docs/FORMAT.md` and architecture notes. The archive suite already round-trips an image
  file and the recursive walk includes `images.json`; the format and architecture sections are written.

## Phase 4 — Evidence

- [x] T009 Add a UI test for the panel states and attachment selection, then run the full verification.
  `manuscript-editor.test.ts` now covers the missing-connection state, an attached image, generation with
  the chapter id, attaching an existing image and the SAM match list; the full suite is 394 tests.
- [x] T010a Live Muse Image generation: 3.8 MB of PNG at 1024×1024 from `muse-image-1.0`, through the
  app's own image service. Recorded in `docs/research/live-meta-2026-10-26.md`.
- [x] T010b Export the manuscript to Word with the image embedded, and the library to an archive.
  Both run in the hidden smoke against the fixture, which now carries an illustration: the Word
  check unzips the file it produced and finds `2 images, 9 text runs`, and the archive check reads
  back `6 entries` with the book's own `book.json` inside. The save dialogs are bypassed for a
  headless run through `STUDIO_EXPORT_PATH`, because an export that always opens a dialog is an
  export no check can make.

## Phase 5 — Image export

- [x] T011 Export every image as a JPEG in one action, separately from the manuscript (002 FR-050).
  `exportBookImages` in `apps/desktop/src/main/export.ts` reads the manifest and bytes through the
  image store. It names each file for its chapter and purpose (`01-the-door.jpg`, `cover.jpg`,
  `character-mara.jpg`), copies JPEGs byte for byte, and converts the rest through an injected
  `nativeImage` transcoder at quality 90. An image it cannot read or convert is skipped with a note.
  The export publishes a new `<book>-images` folder through the Word export's boundary: no picker
  for a book without images, nothing written on cancel, no destination inside the library, no
  existing folder reused, and a staged folder renamed into place so a failure leaves nothing.
  `books:exportImages` carries it to Export images in the library's book actions. Covered by
  `export.test.ts`, `book-actions-images.test.tsx` and a hidden smoke check that reads the JPEG
  back from `STUDIO_EXPORT_PATH`.

## Dependencies

- T001–T005 need no live key.
- T010 needs a Meta key and Muse Image access.
- SAM cutouts (spec 020) reuse the image record and `cutoutOf` field.
