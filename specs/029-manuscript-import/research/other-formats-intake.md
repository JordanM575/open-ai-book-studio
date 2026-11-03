# Other-format intake evaluation (Spec 029 T015)

Validation only. No product behavior changes: the product path still refuses
`.doc`, `.rtf` and `.odt`, pinned by
`apps/desktop/tests/other-formats-intake-validation.test.ts`. Enabling any of
these formats needs a format decision, the plain-text transform,
staged-publication wiring and T013 conformance — the same gate as DOCX (T014).

Probe harness: throwaway scripts in `/tmp/fmt-probe` (not committed). Only the
research conclusions and the committed validation tests below count as evidence.

## RTF — rejected, no parser meets the bar

- Candidates tried: `rtf-parser@1.3.3` (ISC, last published 2022-06) and
  `@iarna/rtf-to-html@1.1.0` (ISC, last published 2022-06). RTF itself is
  frozen (spec 1.9.1, 2008), so the 2022 dates are not the problem; behavior is.
- Fixture: hand-written RTF exercising bold, italic, `\uN` unicode, a header
  destination, a footer destination, a footnote, a table row, a `\pict\pngblip`
  image and a `\ ` escaped space — all legal RTF that real writers emit.
- `rtf-parser` keeps bold/italic spans and unicode correctly, then fails three
  ways:
  1. It **throws** (`empty control word`) on `\pict` image destinations and on
     `\ ` escaped spaces. A parser that throws on legal input cannot sit
     behind an intake: the only safe behavior would be refusal, which is what
     we already have.
  2. It **silently inlines** header, footer and footnote text as ordinary body
     paragraphs. Header wording would become chapter text with no signal.
  3. It **silently flattens** tables: cell wording survives but no
     row/cell/table boundary survives with it, so a two-column row reads as
     ordinary body spans with no structural signal.
- `@iarna/rtf-to-html` threw on the same input, so it is no better.
- Verdict: RTF intake stays refused. Revisit only with a destination-aware
  parser that skips `\pict`/header/footer destinations without throwing, never
  throws on legal control symbols, and surfaces tables and footnotes
  distinctly. The committed tests pin the current failure modes so a future
  re-evaluation starts from evidence, not memory.

## ODT — validated path, not enabled

- Parser: `fflate` (already a desktop devDependency) for the zip layer plus
  `fast-xml-parser@5.11.2` (MIT, actively maintained) for `content.xml`.
- Fixture: minimal ODT synthesized in-test with `fflate` — `mimetype`,
  `META-INF/manifest.xml`, `content.xml`, `styles.xml` and one
  `Pictures/shot.png` — containing outline-level-1 headings, bold/italic
  spans, unicode, a footnote, a table, a `draw:frame` image and header/footer
  text in `styles.xml`.
- Findings:
  - Parse never throws on the fixture; every entry sniffs by zip path.
  - Outline-level-1 headings are chapter boundaries — the same contract as the
    DOCX evaluation. Content before the first such heading is a
    title/front-matter candidate, never a chapter.
  - Body wording and order survive only with `preserveOrder: true` **and**
    `trimValues: false`. The parser default (`trimValues: true`) corrupts word
    boundaries (`Plain body with bold and italic words.` becomes
    `...withandwords.`). Both flags are mandatory for any future transform.
  - Table cell text extracts in document order; the table itself is reported
    as structure loss.
  - Images arrive as `xlink:href` references without bytes; intake must record
    the reference and emit no bytes (same rule as DOCX: never base64).
  - Footnotes parse as distinct `text:note` nodes; headers/footers live in
    `styles.xml` and are sniffed and reported as loss, never body text.
- Verdict: the ODT intake path is validated but **not enabled**. Enabling
  needs the format decision accepting this note, the plain-text transform with
  the two mandatory parser flags, staged-publication wiring and T013
  conformance.

## DOC (legacy OLE `.doc`) — refused, unevaluatable in isolation

- Only candidate: `word-extractor@1.0.4` (MIT, 2022), a pure-JS OLE reader.
  It was **not validated**: no fixture path exists on the reference target —
  no LibreOffice, no antiword, and hand-building OLE `WordDocument` streams
  (FIB, piece table) is out of scope for an intake evaluation.
- Verdict: `.doc` stays refused. Revisit only with genuine `.doc` fixtures and
  a validated reader; a code-inspection-only adoption is explicitly rejected.
