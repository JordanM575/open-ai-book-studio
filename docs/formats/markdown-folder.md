# Markdown folder export

**Status:** Accepted contract by [D-202](../DECISIONS.md#d-202--markdown-folder-export-pure-planner-contract-and-saved-source-bundle);
summary in [FORMAT](../FORMAT.md#markdown-folder-export); the host protocol and production policy are
specified in [the host contract](markdown-folder-host.md) under D-203. This document specifies the
output and the pure planning contract. The pure planner is implemented and accepted; it does **not**
establish an implemented capture, publisher, host journey or qualified target. Those remain
separately owned work in [spec 035](../../specs/035-book-formatting/spec.md).

A Markdown folder export writes one ordinary folder of readable Markdown files in book order, plus
exact copies of the selected attached images. It is a one-way reading copy. It is not a backup, not a
portable archive, not a live manuscript and not a second editable source. There is no hidden manifest,
and nothing in the folder promises re-import or lossless recovery of source metadata. The existing
single-file Markdown export is a different action and keeps its current behavior. Source book files,
chapter files, the image manifest and stored image bytes are never changed by planning this output.

## 1. Saved-source bundle

Export starts only after every required editor, matter and settings save has succeeded and any host
admission hold is clear. The host then collects saved library data into one bundle:

- Collection takes time. Different files may be observed at different times, so the bundle may combine
  states that never existed together at a single instant. No copy, hash or matching sample turns it
  into a simultaneous snapshot of the whole book, and it is never described that way.
- The bundle freezes only after its complete admitted membership, projected values, selected image
  outcomes and ordered warnings have been collected and validated. The click and the start of
  collection are not the freeze point.
- Rendering, legacy consent and publication use only the frozen bundle. No later step rereads source
  to replace a frozen component. Edits after the freeze cannot change the package or its warnings.
- A new capture is a new bundle and invalidates consent given for an earlier one.
- Known missing required content, duplicate or ambiguous identities, an unsupported required schema or
  an internally inconsistent selection stops the export. An unavailable optional image is reported
  separately and does not stop the text.
- Start and end observations that agree are only samples. A change that leaves and returns, or one
  outside a sampled interval, can remain undetected; that limit is disclosed, not denied.

The collection protocol itself — enumeration, observation evidence, detectable-change rules and its
paired positive and adversarial tests — is specified in [the host contract](markdown-folder-host.md)
and must still be implemented and qualified before the journey is exposed. Nothing here relaxes any
other save, recovery or publication hold at the host.

## 2. Inventory, order and names

The folder always contains `README.md` and one `images/` directory, including when the book has no
reading files. Reading files appear in exactly this order:

1. The generated title file, when the matter plan enables the title page.
2. Front sections in captured saved order.
3. The contents file, when canonical settings request one.
4. Chapters in the captured canonical Library order. After each chapter, one illustration file per
   successfully captured selected attachment, in captured manifest order.
5. Back sections in captured saved order.

Let `N` be the number of reading files, illustrations included and `README.md` and sidecars excluded.
Ordinals are dense, 1-based and uniformly `max(4, digits(N))` characters wide, with width 4 when
`N = 0`. Names are positional only: `<ordinal>-title.md`, `<ordinal>-front.md`,
`<ordinal>-contents.md`, `<ordinal>-chapter.md`, `<ordinal>-illustration.md` or
`<ordinal>-back.md`. An illustration's image file is `images/<same ordinal>.<png|jpg|webp>`, using its
verified format. No source title or ID supplies a path component, and no successful plan expresses a
symlink, absolute path, parent traversal or extra directory.

The regular-file inventory is `README.md` first, then each reading file in reading order with an
illustration's image file immediately after its illustration file. Reading order itself excludes the
binary files. Duplicate titles and duplicate order values are valid; ambiguous IDs refuse. Captured
order, including its ties, is kept as captured and is never re-sorted by title, ID or locale.

## 3. File contents

Generated files are UTF-8 without a byte-order mark, with LF separators. No clock, capture timestamp,
host path or random value enters the bytes, so the same frozen bundle and policy always produce the
same plan.

- **README** starts with `# Reading order`, states that the folder is a copy rather than a backup or
  live manuscript, that existing body links are not checked or rewritten, that image copies may
  contain metadata, and that headings and navigation use visible escapes while bodies keep their
  captured text. It then links every reading file, or says there are no reading files. Warnings reach
  the author as a structured result; raw adapter errors are never copied into the README.
- **Contents** holds `# Contents` and links chapters and back sections only, in reading order, or
  says there are no entries. It is separate from the README's complete navigation.
- **Title file** holds the encoded display book title, then the encoded projected subtitle and author
  when each is nonempty.
- **Chapter file** holds the encoded display chapter title, then the exact captured parsed body bytes.
- **Matter file** with a nonblank title holds the encoded saved title, then the exact saved section
  body bytes. With a blank title it holds only the body, which may be empty; no kind heading is
  invented.
- **Illustration file** holds one image line whose placement text matches its README label and whose
  destination is its copied image file. Keeping it in its own file prevents surrounding author text
  from swallowing the generated image line.

Labels name the title page, each front or back section by side position and title or kind, the
contents, each chapter by saved order and title, and each illustration by its chapter and its
selected-record position. Selected-record positions count every selected record for the chapter,
including ones that were omitted, so a surviving illustration keeps its true position. An empty book,
section or chapter is representable and produces no invented chapter. Author body Markdown, HTML and
links are kept without rewriting or fetching, and no claim is made that their destinations resolve
from this folder.

The exact byte templates below are normative. `\n` is one LF byte. The escape notation in §4 applies
to data segments only, never to the generated Markdown syntax. Saved order, side positions and
selected-record positions in labels are primitive positive values in ASCII decimal, never locale
formatting.

- README is exactly `# Reading order\n\n`, then
  `This folder is a copy, not a backup or a live manuscript. Existing body links are not checked or rewritten. Image copies may contain metadata.\n\n`,
  then `Headings and navigation use visible escapes for whitespace and controls. Manuscript bodies keep their captured text.\n\n`.
  It then holds one `- [<label>](<reading-file>)<annotation>\n` line per reading file in reading
  order, where `<reading-file>` is that file's positional name from §2 and `<annotation>` is the
  blank-title annotation from §4 (empty when none applies), or `No reading files.\n` when there are
  no reading files.
- Labels are exactly `Title page`; `Front matter <side-position>: <title-or-kind>`; `Contents`;
  `Chapter <saved-order>: <title>`, or `Chapter <saved-order>` when the chapter title is blank;
  `Illustration for Chapter <saved-order>: <title> (<selected-record-position>)`, or
  `Illustration for Chapter <saved-order> (<selected-record-position>)` when the chapter title is
  blank; and `Back matter <side-position>: <title-or-kind>`. Side positions count every saved
  section on that side. Selected-record positions count every selected record for the chapter,
  including omitted ones. `<title-or-kind>` is the encoded saved title for a nonblank title and
  otherwise the fixed kind label from the existing `kindLabel`. Titles in labels are encoded data.
- Contents is exactly `# Contents\n\n` plus the same `- [<label>](<reading-file>)<annotation>\n`
  lines for chapters and back sections only, in their reading order, or `No entries.\n` when there
  are none. It is separate from the README's complete navigation.
- Title file is exactly `# <encoded display book title>\n\n`, followed in order by
  `<encoded projected subtitle>\n\n` and `<encoded projected author>\n\n`, each only when nonempty.
- Chapter file is exactly `# <encoded display chapter title>\n\n` followed by the exact captured
  parsed body bytes, with nothing added after them.
- Matter file with a nonblank title is exactly `# <encoded saved title>\n\n` followed by the exact
  saved section body bytes. Matter with a blank title holds only its body, possibly zero bytes, with
  no generated kind heading.
- Illustration file is exactly `![<encoded placement label>](images/<ordinal>.<extension>)\n`,
  where `<ordinal>` is the illustration file's own ordinal, `<extension>` is its verified format
  (`png`, `jpg` or `webp`), and the placement label is the same descriptive label as its README link.

Title-page projection uses canonical `settings.manuscript` and `readMatter`/`matterPlan` semantics,
and an unreadable required matter value refuses. When matter is absent, null or semantically empty,
the title-page plan is the legacy plan: the projected subtitle is `book.description.trim()` and there
is no author. Otherwise the plan follows the titlePage toggle and projects `matter.subtitle.trim()`
as the subtitle and `matter.author.trim()` as the author. These trims and omissions are deliberate
D-169 projections, not exact raw-field preservation, and unknown fields are not copied into this
folder.

## 4. Text representation

Every emitted metadata or body string must be well-formed Unicode scalar text. A lone surrogate in any
emitted field refuses the plan with a bounded field-specific reason before any replacement character
can appear. A source field that is never emitted is not refused merely for containing such a value.

Metadata uses two reversible stages, escape then Markdown-escape:

1. Escape works scalar by scalar without normalization. A literal backslash doubles. Carriage return,
   line feed and tab become `\r`, `\n` and `\t`. A space at either edge or in a run of two or more
   becomes `\s`; a single inner space stays a space. Every other scalar in the following fixed ranges
   becomes `\u{HEX}`: the C0 and C1 controls U+0000–U+001F and U+007F–U+009F, U+00A0, U+00AD,
   U+034F, U+061C, U+1680, U+180E, U+2000–U+200F, U+2028–U+202F, U+205F–U+206F, U+3000,
   U+FE00–U+FE0F, U+FEFF, U+E0000–U+E007F and U+E0100–U+E01EF. `HEX` is uppercase, at least four
   digits, without unnecessary leading zero beyond that minimum. The named carriage-return, line-feed
   and tab rules win over the ranges. Every other scalar is unchanged.
2. Markdown-escape then prefixes every ASCII punctuation scalar in U+0021–U+002F, U+003A–U+0040,
   U+005B–U+0060 and U+007B–U+007E with a backslash.

For a known generated data segment the stages reverse exactly: remove the punctuation escapes, then
read the escape notation left to right. Because literal backslashes were doubled first, author text
containing the two characters `\` and `n` stays distinct from an actual line feed. This notation is
not a general Markdown parser and does not promise that every reader shows the same glyphs. Bodies
never use either stage.

Blank means the value is empty after trimming whitespace. A nonblank title is never trimmed. A blank
book title displays as `Untitled book` and a blank chapter title as its chapter position. A blank
matter title produces no heading, and its navigation link carries an annotation outside the link:
` — Saved title: (empty)` for an empty original, or the encoded original for nonempty whitespace.
Illustration links for a blank chapter title carry the same annotation. Clarification, not a
behavior change: the annotation applies to every navigation link whose label uses a blank fallback —
the title-page link, a chapter link, a matter link and an illustration link for a blank chapter
title — in the README and, for chapters and back sections, in the contents. These fallbacks are visibly
generated labels, not claims about the saved value. With the title page off, no book-title page, link
or annotation is invented.

Chapter equality means the UTF-8 bytes of the captured parsed chapter content, which the library has
already normalized; it is not equality with the original chapter file on disk. Matter equality means
the UTF-8 bytes of the saved section text. No body is appended to, trimmed, reflowed or given an
inserted image. A NUL byte in a body stays a NUL byte even when a reader displays it as a replacement.

## 5. Legacy values

The legacy free-form record stays exactly as written and is never converted, ordered or deleted by
this export. Before publication, each nonempty value in the captured record is tested against the
selected output. A value counts as represented only under one of these exact rules:

- Its raw string exactly equals the text of an included saved matter section. No trimming, substring
  search, title match, chapter-prose match or unrendered state counts.
- Its key identifies the author or subtitle under the existing classification below, the title page is
  enabled, the corresponding projected value is nonempty and actually emitted, and `raw.trim()`
  equals that emitted value. This acknowledges the deliberate title-page trim; it does not claim the
  raw value was preserved.

Key classification is performed exactly as:

```js
key.toLowerCase().replace(/[^a-z]/g, "")
```

Lowercase first, then remove every character outside ASCII `a`–`z`. No locale variant, Unicode
normalization, prefix removal or filter-first variant is substituted. A result of `author` or
`authorname` identifies the author; `subtitle` identifies the subtitle; every other result identifies
neither, however close it looks. The general section-body rule above remains available for every key.
This classification only decides exclusion; it never converts or orders the record.

Empty raw strings are ignored. Whitespace-only nonempty values remain excluded unless an included
section body matches them exactly. Two keys may be represented by the same section body. Every other
nonempty value is excluded. The result lists the excluded keys in capture order with stable reasons,
identifying malformed keys by a bounded ordinal fallback and never printing legacy values or unsafe
raw errors. The author chooses **Continue without them** or **Cancel**. The choice binds to the frozen
bundle, book and plan; a new capture or changed projection needs a new choice. Either choice preserves
the record and every draft, and no consent is inferred from an unrendered field or from the record's
mere presence.

## 6. Trusted input, ownership and budgets

The planner is pure: no I/O, Library open, provider call, path lookup, decoding or capture. It takes
one complete trusted narrow projection — book identity and title, description, canonical manuscript
settings, matter and sections, ordered chapters, bounded legacy pairs, selected image outcomes and
structured warnings — plus an explicit policy, and returns one complete plan with frozen warnings and
excluded-legacy references, or one structured refusal. It never returns a partial book, trims input to
fit, drops an image to fit, approves exclusions or permits publication.

Construction is a trusted-code seam. Private own-data records are built from validated saved data
without invoking caller callbacks, coercion, iterators or getters, and partially built state is never
exposed. The planning entry accepts only handles privately registered by that construction, checked
before any property is read; unregistered objects and wrappers are refused without touching their
properties. This is not a promise that every proxy can be detected or that a hostile producer becomes
authentic. If inputs could arrive from an untrusted producer, a separately specified serialization or
isolation boundary is required before planning.

Image bytes enter as fixed private copies. Shared, resizable, detached or unstable storage refuses,
and no caller keeps a mutable alias to plan bytes. Retrieval returns a fresh exact-size copy of one
named planned file; the caller may mutate that copy without affecting the plan or another retrieval.
Each retrieval checks the remaining budget before allocating and charges the plan for its lifetime,
including repeats of the same file, with no refund for a claimed release.

Every policy maximum is a finite nonnegative safe integer; there is no implicit production default.
The counted dimensions are input strings in UTF-16 code units and scalar UTF-8 bytes, input
collections, per-image and total image bytes with identical bytes in distinct records counted
separately, actual generated UTF-8 counted at every occurrence including repeated labels and
annotations, total output bytes, regular files and directory entries, cumulative retrieval requests
and bytes, and a conservative accounted payload covering retained input strings charged at
2 × code units (UTF-16 code units), captured images, materialized output, declared temporary
payloads and every issued copy, with overlaps charged even
where storage could be shared. Counting is bounded and checked before materialization, and the
temporary-payload strategy must be documented by any implementation. A fresh plan must leave room to
retrieve every output file once under every limit at the same time, not merely under one counter;
later repeats may exhaust the remaining headroom. The accounted payload is a logical envelope, not
measured heap or memory use. Acquisition bounds and real host peaks must still be measured before
exposure, and exceeding any limit refuses the whole plan by dimension rather than narrowing the book.

## 7. Selected images and warnings

Selection takes every distinct manifest record attached to a captured chapter through the existing
attachment relation, in captured per-chapter manifest order, including multiple records on one chapter
and distinct records with identical bytes. Unattached, cover and character images are outside this
projection. Duplicate IDs, an ambiguous selection or a different record substituted after capture
refuses as a required-input inconsistency.

Before planning, the capturing side binds the selected record's book and manifest membership,
identity, attachment, file name, format and MIME type, dimensions, byte length and SHA-256 to its
privately captured bytes, requiring the detected format, MIME type and positive dimensions to match
the record. The planner trusts that outcome, checks its structure and budgets, and copies the bytes
exactly. It does not re-prove provenance: a supplied digest alone never authenticates a supplier.
Agreement of length, hash and header does not prove a complete, decoded, sanitized or universally
supported image.

A missing, unreadable, mismatched or unsupported optional image produces a frozen omission warning
naming its chapter and selected position, and the manuscript text still exports. A missing or corrupt
manifest whose names cannot be known produces one prominent list-level warning, never the appearance
of a valid empty manifest; malformed or ambiguous selection data is never reclassified as an empty
list, and an unknown or newer image schema refuses its unsupported semantics. Warnings are ordered
list-level first, then by chapter and selected position, carry bounded stable codes and safe
identities, and are never rebuilt from raw adapter errors. Every frozen omission and every written
file location must reach the author accessibly no later than confirmed completion. Copied image files
are exact originals and may contain embedded metadata such as camera or generation details; that is
disclosed and needs no new approval. No prompt, provider, model, cost or provenance text is injected
into the Markdown by default, and the generated placement text names position rather than describing
what the picture shows.

## 8. Publication and cancellation gates

Nothing in this contract publishes a folder. Before any author can use the journey, the host side must
still qualify all of the following on each admitted target, with existing single-file exports kept
working throughout:

- A validated destination that cannot alias the book source, with stable source and destination
  identities and an owned sibling staging area using only regular files and directories.
- A genuinely no-replace commit: another actor creating even an empty destination while staging lasts
  must prevent publication. An existence check followed by an ordinary rename does not meet this rule.
- Owned cleanup that reports any stage it could not remove, and protection of a previous destination
  on every known failure or accepted cancellation.
- Replacing an existing or nonempty folder, and preserving changes made after consent, as separately
  owned successor work with its own consent. No unowned destination is deleted to recover.
- An attempt-bound lifecycle covering capture, destination choice, staging, publication and truthful
  settlement. Cancellation accepted before commit must actually prevent the commit and settle owned
  work; after publication begins it is reported as too late and then by its real outcome. An outcome
  that cannot be confirmed is reported as unconfirmed, never as success or automatic failure, and a
  readback alone does not attribute publication to the attempt that started it.
- Accessible delivery of the destination, every written file, all warnings and the next useful action,
  with offline behavior and no provider, service or link-fetching call by the exporter itself.

Browser output stays unavailable until an adapter is qualified, and desktop, native, removable,
network and synced-folder destinations each need their own capability evidence. Crash and restart
recovery of an interrupted publication needs its own claim and evidence.

## 9. Limits

This folder makes no physical-page, typography, pagination, link-resolution or reader-identity claim:
readers may render the same files differently, and author links may not resolve from the folder.
Paged-format illustration placement, the separate all-images action, the portable archive, image
generation validation and word-processor captions remain owned by their existing contracts and are not
advanced by this one. Production limit values, the capture protocol, target qualification, replacement,
cancellation and the mounted journey all remain open work; recording this contract implements and
qualifies none of them.
