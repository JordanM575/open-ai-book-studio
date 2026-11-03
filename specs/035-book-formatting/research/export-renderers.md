# Research: export renderers and determinism (D-108)

**Task:** 035 T006 · **Status:** research recorded, decision not accepted — no renderer is selected here.
**Evidence:** `apps/desktop/tests/export-renderers-premises.test.ts` (3 pass, synthetic books);
`apps/desktop/src/main/export.ts` (`buildDocx`, `collectDocxImages`, `exportManuscriptDocx`).
Hands-on evidence covers the `docx` 9.x pipeline only. No converter binary (LibreOffice, Typst,
pandoc) is installed in this checkout and none was installed for this task, so the other
alternatives below are a documentation survey, not test results. No live provider, paid service
or publisher upload was used.

## Observed baseline: the current DOCX pipeline

- `buildDocx` renders from the saved book: title page (title + description), one `HEADING_1`
  chapter heading per chapter in `order`, then one paragraph per non-empty body line with the
  canonical `settings.manuscript` values applied (T004 pins the OOXML anchors).
- Each body line becomes its own paragraph. Verse-like input (short lines) therefore renders as
  successive paragraphs with body spacing — there is no stanza grouping.
- An attached illustration is placed after the chapter body as a centered image capped at
  480×640 px, with the prompt as an italic caption truncated at 160 characters and alt text
  naming the chapter. Unattached images, WebP images and unreadable bytes are skipped with a
  warning and never fail the run (T004 pins the skip rules).
- Book `frontMatter` records are not rendered at all today. Matter rendering belongs to T007.
- Publication goes through `exportManuscriptDocx`: picker cancel, in-library alias refusal,
  explicit replacement consent, destination recheck and atomic staged writes (T005). That
  boundary is renderer-independent and stays whatever D-108 selects.

## Determinism findings (verified)

- The same saved book builds to byte-identical document content: every `.xml`/`.rels` part
  except `docProps/core.xml` is identical across builds (premise test).
- Zip entry dates are fixed by the packer across builds (premise test parses the local headers).
- The only variance is wall-clock `dcterms:created`/`dcterms:modified` in `docProps/core.xml`
  (premise test pins their presence and shape).
- Consequence: a byte-identical container needs only core-timestamp normalization (fixed or
  book-derived timestamps). Nothing in the document content fights determinism.

## Alternatives

- **`docx` 9.x (current, verified above).** Pure TypeScript, no native dependency, deterministic
  content, fixed entry dates. Limits: no PDF or EPUB output; sets no explicit page size,
  margins or trim (sections carry empty properties, so Word defaults apply); references fonts
  by name and embeds nothing; timestamps need normalization for byte-identical files.
- **LibreOffice headless (`soffice --convert-to`).** Reference-fidelity DOCX→PDF used across
  the industry. Costs: a multi-hundred-megabyte native install per platform, which lands in
  the D-115 signing/packaging work; nondeterministic metadata of its own; a subprocess the
  studio must sandbox and version-pin. Not evaluated locally — no binary present.
- **`pdf-lib`.** Pure TypeScript PDF assembly with no native dependency and fully
  author-controlled metadata (determinism-capable). It is not a layout engine: the studio
  would place every glyph run, line break and image itself or pair it with a layout pass.
  No pagination, reflow or trim logic comes with it.
- **Typst.** A real typesetting engine with deterministic builds and print-plausible PDF.
  Costs: a native binary per platform (same packaging shape as LibreOffice, smaller), and a
  markup pipeline that duplicates rather than reuses the OOXML work. Not evaluated locally.
- **EPUB (`epub-gen` family, or a hand-assembled container).** EPUB is a zipped container like
  DOCX: the studio could assemble OPF manifest + one XHTML per chapter + sidecar images with
  the same staged-write discipline, determinism-capable with fixed dates. Conformance
  evidence would need EPUBCheck (a Java tool not installed here). Not evaluated locally.
- **pandoc.** Universal document converter, but a native Haskell binary per platform with the
  same packaging burden as LibreOffice, and its DOCX output would replace rather than reuse
  the current pipeline. Not evaluated locally.

## Proposed determinism requirements (for the accepted decision)

1. Same book bytes in, byte-identical container out: deterministic content parts, normalized
   container metadata (fixed or book-derived timestamps), fixed entry dates, embedded image
   bytes unmodified.
2. A premise test comparing two builds of one synthetic book enforces (1), excluding nothing
   once normalization lands.
3. Renderers that shell out must pin their binary version and record it in the export; a
   version change is a renderer change, not a silent drift.

## Proposed per-target illustration and packaging contract

- Common: illustration bytes embed unmodified; a skipped or failed illustration warns and
  never fails the run; alt text is always present.
- DOCX: keep the current shape — inline `word/media/*` part, centered image after the body,
  caption, Word-compatible formats only.
- PDF: a single self-contained file, images embedded, no sidecar; illustration order mirrors
  the DOCX order until a layout decision says otherwise.
- EPUB: container with an OPF manifest, one XHTML per chapter, images as sidecar files under
  `images/` referenced relatively; no remote resources.
- Markdown: the T014 folder export owns this — ordinary files with images beside chapters.

## Unresolved conformance limits (no claim may be made until these close)

- KDP or any publisher acceptance cannot be verified here: it needs an upload to an
  external service, which is out of bounds for synthetic checks. No publisher-readiness badge
  until a real upload path is authorized and tested.
- Exact pagination, trim size and print measurement need the T008 layout decision first; the
  current pipeline sets no page geometry.
- Font embedding and subsetting have no design: fonts are referenced by name only.
- PDF/UA accessibility and EPUBCheck validation have no local validators; the external
  tooling is unresolved.
- Cross-reader rendering (Word vs Pages vs LibreOffice for the same OOXML) is an untested
  matrix.

## Recommendation

Select no renderer in this task. The alternatives above stay in play except on evidence the
decision record does not yet have. The proposed acceptance path: author accepts the
determinism requirements and the per-target packaging contract, then a follow-up task selects
one renderer per target against those criteria with synthetic conformance fixtures. That
selection, and any publisher claim, waits on the accepted decision — exactly what T006,
T013 and T014 already require.
