# Tasks: book formatting and export

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)
**Status:** Draft / Planned. Every task is unchecked; no implementation, testing or acceptance is claimed.

All tests in this plan use synthetic fixtures in isolated temporary libraries. Do not use real
manuscripts, credentials, live providers, paid services or devices.

## Phase 1 — Unblocked editor, preview and current DOCX contract

- [x] **T001** Design the Format journey around the existing `settings.manuscript` values. Specify the
  target selector, unsupported-target state, accessible control labels and a persistent **Approximate
  preview** disclosure. Do not add persisted format-profile fields or duplicate typography settings.
  Recorded in `specs/035-book-formatting/research/format-journey.md`: toolbar + overflow entry,
  native radio target selector (DOCX available; PDF/EPUB/Markdown disabled with Planned notes),
  typography controls bound to `settings.manuscript` with immediate full-settings-merge saves,
  always-visible disclosure, idle/saving/error/cancel states, saved-chapters content source.
- [x] **T002** Build the local approximate-preview surface from a synthetic saved-book fixture. Verify
  that its disclosure is always visible and that it makes no page-count, trim-measurement, pagination
  or publisher-readiness claim. No export engine or matter schema is needed for this task.
  Built as `FormatDialog` (`packages/app/src/components/FormatDialog.tsx`) wired into
  `WorkspaceView` (toolbar `format-book` + overflow `more-format`); preview renders saved chapter
  bodies with the selected typography and a nondismissible disclosure. Hidden smoke asserts the
  preview and disclosure in the real UI.
- [x] **T003** Add UI contract tests with synthetic content for canonical typography binding, keyboard
  access, preview disclosure, target availability, and idle/error/cancel states. Keep all preview data
  local and assert that opening it causes no provider request or source write.
  Covered by `apps/desktop/tests/format-dialog.test.tsx` (5 pass): settings binding, full-merge
  persistence preserving agent/cache sections, disclosure across idle/change/failure, disabled
  planned targets, schema-enum option parity, failed-save revert + notice, no chapter writes.
- [x] **T004** Characterize the current DOCX journey with a synthetic isolated library: pending editor
  input is flushed first, the main process reads saved book data, current canonical typography is
  applied, and attached images are resolved through the existing 019 store. Assert that source files
  are unchanged. Do not assert PDF/EPUB behavior, exact pagination or publisher compatibility.
  Covered by `apps/desktop/tests/export.test.ts` (typography OOXML anchors for Georgia/14pt/1.5/0.3in/Left,
  whole-library byte-identical snapshot, `collectDocxImages` store/skip rules) and
  `apps/desktop/tests/docx-export-flush.test.tsx` (dirty editor saves before `books.exportDocx`,
  author sees the saved-file note). The illustration step moved verbatim into
  `collectDocxImages` (`apps/desktop/src/main/export.ts`) so the boundary task can reuse it.
  One editor fix: unmount now clears the pending draft timer, which otherwise fired into a
  torn-down bridge after checks.
- [x] **T005** Specify and test the current DOCX safe-publication boundary using synthetic fixtures:
  cancel before destination selection, source-path alias rejection, explicit replacement consent,
  destination recheck, staged output, and preservation of any prior output on injected failure or
  cancellation. This task must not require a new book schema or a new renderer choice.
  Implemented as `exportManuscriptDocx` (`apps/desktop/src/main/export.ts`) with injectable
  picker/consent/stat/writer seams; the IPC handler keeps its `string | null` contract, dialog
  copy and headless hook, so no renderer change was needed. Covered by 10 boundary tests in
  `apps/desktop/tests/export.test.ts` (cancel, in-library alias refusal, decline/accept consent,
  post-consent change and post-consent creation refusal, injected failure preserving prior bytes,
  default atomic staging with no temp debris, name suggestion, root-prefix check).

## Phase 2 — Resolve public decisions before dependent work

- [ ] **T006** Research D-108 using public documentation and synthetic test documents; record the
  alternatives, determinism requirements, unresolved publisher-conformance limits, and per-target
  illustration placement/sidecar packaging contract in the public decision record. Do not select a
  DOCX/PDF/EPUB renderer until the decision is accepted. This task blocks renderer selection,
  per-target illustration placement/packaging and conformance work only.
  Research recorded 2026-11-03 (not accepted): `research/export-renderers.md` compares the
  `docx` pipeline (verified deterministic content, fixed entry dates, wall-clock core
  timestamps) against a documentation survey of LibreOffice headless, `pdf-lib`, Typst and EPUB
  assemblers; D-108 proposes the determinism requirements and per-target packaging contract with
  KDP acceptance, pagination/trim, font embedding and validator tooling explicitly unresolved.
  Renderer selection, per-target placement/packaging and conformance work remain blocked.
- [ ] **T007** Decide and record the additive ordered-matter schema and explicit legacy-conversion
  behavior. Define how populated `frontMatter` records are classified, ordered, preserved, reviewed
  and rolled back. Until accepted, do not migrate or reinterpret existing records. This task blocks
  persisted matter schema, conversion UI and matter export only.
  Research recorded 2026-11-03 (not accepted): `research/matter-schema.md` pins the current
  whole-record replace, ordered string survival, strict-open brick on rich values and failed-patch
  byte preservation; D-169 proposes the key-function kind table, additive `matterOrder` with a
  deterministic fallback, order-only confirmed conversion, clear-to-rollback and tolerant carry for
  unreadable records. T009–T014 remain blocked.
- [ ] **T008** Decide and record whether target-specific format profiles persist per book or per export
  and which physical-layout controls, if any, are modeled. Do not claim physical measurement. This task
  blocks only persistent target-specific settings and physical-size controls.
  Research recorded 2026-11-03 (not accepted): `research/format-profiles.md` pins the
  settings-nesting strip hazard, top-level survival across the FormatDialog merge, transient
  target state and library-default A4/1-inch geometry; D-170 proposes transient per-export now,
  a reserved top-level `formatProfiles` shape later, and no physical controls until D-108
  acceptance. Persistent settings and physical-size controls remain blocked.

## Phase 3 — Matter schema and authoring

- [ ] **T009** After T007 is accepted, add the approved additive versioned matter schema and
  backward-compatible parsing. Preserve `frontMatter`, unknown fields and old-book readability; add
  round-trip tests using synthetic book files. Update `docs/FORMAT.md` in the implementation change.
- [ ] **T010** After T007, implement author-reviewed legacy conversion exactly as decided. Show the
  proposed placements before saving, require confirmation, preserve the original record as specified,
  and make cancel or failure leave the book unchanged. Test empty, populated, malformed and repeated
  conversion cases with synthetic records.
- [ ] **T011** Implement add/edit/reorder/remove for front and back sections, including editable
  templates and keyboard-only reordering. Test persistence, confirmation and cancel behavior with
  synthetic fixtures. Do not change chapter files or image records.
- [ ] **T012** Connect the approved ordered matter to the approximate preview and its accessible
  structure. Verify front matter, chapters and back matter appear in the selected order without
  claiming measured pages.

## Phase 4 — Format outputs and publication

- [ ] **T013** Extend the existing DOCX export from the saved snapshot to include only matter that has
  passed the approved conversion/schema flow. Preserve the existing typography source and use the
  renderer decision from T006 before making output-conformance claims. Verify legacy values are never
  silently mapped or omitted.
- [ ] **T014** Implement Markdown folder export from the saved snapshot after the matter and output
  packaging contracts are accepted. Write ordinary ordered Markdown files and copy any required
  attached image files to the export destination without changing the 019 source files. Test with
  synthetic text and image fixtures.
- [ ] **T015** After T006, implement the selected PDF and EPUB renderer adapters. Validate structural
  output with synthetic books containing ordered matter, verse-like lines and attached synthetic
  images. Keep preview copy approximate and make no eligibility, pagination, measurement or publisher
  readiness claims not supported by the accepted decision.
- [ ] **T016** Apply one safe-publication contract to every implemented target: snapshot after successful
  flush, source immutability, destination validation and recheck, replacement consent, cancellation,
  staged publication, cleanup reporting and prior-output preservation. Exercise each failure boundary
  against isolated temporary destinations.
- [ ] **T017** Complete synthetic end-to-end journeys for DOCX, PDF, EPUB and Markdown as each renderer
  becomes available. Verify the author-visible destination/status, source hashes, matter order,
  optional-image warning, save conflict, cancel and failure behavior. Unsupported targets must remain
  clearly unavailable until their renderer task is complete.

## Phase 5 — Public format and acceptance record

- [ ] **T018** Update `docs/FORMAT.md`, the public decision record and any required ADRs for accepted
  schema and renderer decisions. Keep D-115 separate from export. Update the changelog in the
  implementation change, not in this spec-authoring task.
- [ ] **T019** Review the final author-visible journey against spec 002 and spec 019: DOCX/PDF/EPUB/
  Markdown scope, ordered matter, canonical typography, approximate-preview disclosure, saved-source
  safety and image-store ownership. Record remaining gaps without claiming publisher readiness.
