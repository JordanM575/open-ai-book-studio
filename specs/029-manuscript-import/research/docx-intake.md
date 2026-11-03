# DOCX intake validation (spec 029 T014)

Status: validated 2026-11-04. The intake feature itself is NOT enabled: the product path
still refuses `.docx` (pinned by `docx-intake-validation.test.ts`), and no IPC, UI or
format change ships with this note. What follows is the evaluated contract a future
intake implementation must meet, proven against synthetic documents only.

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
  `word/media/*` presence plus counts.

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

A format decision (this note proposes mammoth + sniffing but does not accept it), the
plain-text transform from mammoth HTML to canonical chapter bodies, the IPC/storage/UI
wiring through the existing staged-publication path, and the per-target conformance
checks of spec 029 T013. None of that is claimed here.
