# DOCX intake validation (spec 029 T014)

Status: validated, then enabled by D-183 on 2026-11-03 for the macOS desktop target. The
sections below record the evaluated contract; "Enabled" at the end records how the intake
meets it and what implementing it corrected. Every proof uses synthetic documents only.

## Parser verdict: mammoth plus zip sniffing

- `docx@9.14.0` (already the export dependency) exports no document reader — verified
  against its export list. It stays the fixture generator, not the intake parser.
- Manual OOXML is rejected: full reimplementation for boundaries mammoth already exposes.
- **Mammoth** converts the body with a small style map (`Title` → `h1.title`); Heading 1/2
  arrive as `h1`/`h2` untouched. It runs in Node and in browsers, so the contract holds
  for desktop first and web later.
- Mammoth's `messages[]` is nearly silent on real-world loss: textboxes inline as plain
  paragraphs, headers/footers/footnotes vanish, all with no message. Loss reporting therefore
  cannot rely on messages; it sniffs the package with `fflate` (already a dev dependency):
  `word/header*.xml`, `word/footer*.xml`, `word/footnotes.xml`, `word/endnotes.xml` and
  `word/media/*` presence plus counts. *Corrected while enabling:* mammoth does convert
  footnotes and endnotes, as `[n]` reference marks plus a list appended after the body. Only
  headers and footers vanish. It also drops tracked deletions, simple fields (`w:fldSimple`,
  shown text included), charts and SmartArt without a message.

## Chapter boundaries

Split on non-title top-level headings (`h1` without the title class). Content before the
first heading is the title/front-matter candidate, never a chapter. Validated: a Title plus
two Heading 1 sections yields exactly `["Chapter One", "Chapter Two"]`.

## Body fidelity

Paragraphs, bold/italic and list wording survive verbatim in the HTML the transform will
consume. The future plain-text transform is out of scope here; what is proven is that no
words are lost before it.

## Images: never base64

Mammoth's default embeds every image as a `data:` URL with no warning — a direct
violation of the no-base64 rule (002 FR-047). The intake MUST override `convertImage`:
the validated override records the content type, emits no image bytes, and leaves no
`data:` URL in the output. Images are a counted loss note for v1, never embedded files.

## Tables

Mammoth yields `<table>` HTML with cell text in document order (validated north-before-south
ordering). The intake extracts cell text in that order as plain lines and reports the table
count as structure loss. Tables never block the import and never lose words silently.

## Silent drops and the loss report

Headers, footers, footnotes, endnotes, text effects and textboxes either vanish or inline
without a signal. The intake sniffs the package listing (validated: header/footer parts
and the single media file are all discoverable) and the loss report names each dropped
structure with its count. A document with none of these reports no loss section.

## What enabling still requires

Each item below is now done, and the evidence is listed with it.

- **Format decision.** Accepted as D-183.
- **Transform from mammoth HTML to canonical chapter bodies.** `convertDocxHtml` in
  `packages/core/src/manuscript-import/docx.ts`; rules below.
- **Wiring through the existing staged-publication path.** `readImportSource` sends `.docx`
  to `readDocxSource` (`apps/desktop/src/main/docx-import.ts`). The picker channel returns the
  same validated source, and confirming publishes through the unchanged
  `LibraryService.importManuscript`. No new channel was added.
- **Per-target conformance (T013).** The hidden smoke run drives a synthetic Word document
  through the real preview, confirm and result on the macOS reference target. Windows, Linux,
  web and mobile stay refused.

## Enabled: mapping, limits and the loss report

- **Container.** The intake checks the zip signature, then that `[Content_Types].xml`
  declares the WordprocessingML main part, then `word/document.xml`. An OLE container is
  refused as password-protected (when it has an `EncryptedPackage` stream) or as an older
  `.doc`. A macro-enabled main part or `word/vbaProject.bin` is refused. An OpenDocument
  `mimetype`, any other zip and a damaged zip are refused too.
- **Limits.** The file may be at most 5 MiB, which is 029 decision 2. XML parts may expand to
  at most 50 MiB in total, judged by their declared sizes before any inflation. Images and
  other binaries are never decompressed. Mammoth reads a stored re-pack of the bounded parts
  only. The converted text may be at most 5 MiB, the same ceiling as a text file, because that
  text is what crosses the bridge. One import creates at most 200 chapters, the limit in the IPC
  contract. A document past any limit is refused before the preview. For scale, a synthetic 153,000-word, 30-chapter document converted in 62–110 ms under Bun. Its text was repetitive, so it compressed far better than a real manuscript would.
- **Mapping.** Mammoth runs with its embedded style map off. Each paragraph becomes one block,
  and blocks are separated by one blank line. Each empty paragraph adds one blank line, so a
  blank-line scene break survives, and a typed scene break such as `* * *` stays its own
  block. Line breaks stay line breaks. `<strong>` and `<em>` become `**` and `*`, with edge
  spaces kept outside the markers. List items become `- ` or `1. ` lines, nested by
  indentation. Quote and Intense Quote paragraphs become `> ` lines. Table cells become plain
  lines in document order. Headings become `#` lines. Text is otherwise kept verbatim.
- **Chapters.** Proposed boundaries are the headings at the shallowest level present; Title
  paragraphs are never boundaries. A chapter whose first line is a heading takes that heading
  as its title, and removing the split puts the heading back in the body. A Title paragraph at
  the very start becomes the proposed book title. Text before the first heading stays an
  opening chapter, not dropped as the validation above suggested, so no words are lost; the
  author can merge it by removing the split. With no headings, the whole document is one
  chapter.
- **Loss report.** Items in the converted flow carry their line: tables, images (with alt
  text), footnotes, endnotes and comments (with their text), links (with the address),
  underline, strikethrough and checkboxes. Items found by scanning the package carry the
  heading they fall under: tracked insertions (kept, as if accepted), tracked deletions (left
  out), text boxes (text kept), fields (shown text kept), charts and diagrams, and equations.
  Headers and footers carry their text. Mammoth's unsupported-symbol and ignored-element
  warnings become "symbol" and "other" items. Content inside `mc:Choice` is skipped, because
  mammoth reads only the fallback. Images are never stored.

Evidence: `apps/desktop/tests/docx-import.test.ts` (real mammoth on synthetic `docx` documents),
`packages/core/tests/manuscript-import-docx.test.ts` (container and transform edge cases), the
preview and journey component tests, and the hidden smoke Word journey.
