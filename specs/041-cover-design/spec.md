# Book-level cover design

**Status:** Draft / Planned — not implemented or accepted
**Number:** 041
**Requirement:** REQ-COVER-001
**Depends on:** 019 asset/provenance contracts; 035 immutable export and target validation;
002 checked Library writes. Image generation additionally uses 011/022 consent/capabilities.
**Completion lane:** L10. A missing optional cover feature does not by itself block an existing
035 export; target-specific validation may require it for a named readiness claim.

## Why and user stories

A chapter illustration is not a book cover. An author needs a book-level composition, asset choice,
typography and target-specific output without changing chapter attachments or manuscript text.

1. Select source art, title and author text; preview a front cover with editable layout.
2. Export a cover while preserving original art and keeping approximate previews honestly labelled.
3. For a print wrap, inspect the named trim/bleed/spine inputs and any unknown measurements before
   asking for readiness validation under 035.

## Requirements

- **FR-001** Cover compositions and asset references MUST be book-level, distinct from chapter
  illustrations. IDs, layout, provenance/licensing and version/conflict semantics need the accepted
  storage decision below before persistence. Originals and unknown metadata MUST be preserved.
- **FR-002** Preview/export MUST use an immutable saved composition/source snapshot. No cover action
  may rewrite the manuscript or chapter image attachments. Asset paths and dimensions MUST be
  validated; missing/corrupt/unsupported art produces an actionable error, not a blank success.
- **FR-003** Output MUST identify target, units, dimensions, resolution, color assumptions, text/font
  handling, bleed and safe area where applicable. Print spine width MUST depend on accepted measured
  page count and paper/binding rules; unknown inputs MUST remain unknown, not guessed readiness.
- **FR-004** Approximate preview MUST be labelled approximate. Target readiness requires the named
  versioned 035 rule set and all required measurable checks. Exporting an image is not KDP acceptance.
- **FR-005** Export MUST preserve prior destinations on failure and avoid silent overwrite. Failed
  save/export or conflict MUST preserve recoverable composition/source data and explain the next
  action. All library mutations go through atomic, version/hash-checked Library operations.
- **FR-006** Optional generation MUST disclose provider/model, prompt and selected outgoing assets,
  price facts or unknown cost, and require explicit start. No automatic retries/fallback or paid
  batches. No unrequested manuscript upload or implied image rights/ownership guarantee.
- **FR-007** The preview/editor MUST have keyboard-accessible controls and support light/dark and
  reduced-motion/transparency preferences. Unsupported hosts/targets MUST refuse before side effects.

## Acceptance scenarios

1. Compose/export a synthetic front cover: dimensions and included text match the saved snapshot;
   manuscript, chapter attachments and original image hashes remain unchanged.
2. External composition edit causes a recoverable conflict, not overwrite. Missing asset, invalid
   path/dimension, interrupted save and injected export failure preserve originals/prior destination.
3. Print wrap with unknown page count/paper rule is unknown/not ready. Known synthetic inputs
   match the accepted dimension formula; target/rule version is visible. No publisher acceptance claim.
4. Pre-generation cancel causes zero provider calls; a mock request contains only disclosed inputs.
   Provider failure has no automatic retry and preserves the last composition.
5. Keyboard-only authoring/export, reduced-motion/transparency preferences and unsupported-host
   refusal pass on the claimed built target.

## Non-goals

Replacing 019 chapter illustrations, claiming rights to stock/generated art, automatic cover upload,
publisher/store submission, inventing spine measurements, font licensing or signing off print output
without independently measured evidence.

## Open decisions

Record accepted architecture in docs/DECISIONS.md and an ADR before dependent implementation.

| ID | Question / evidence | Blocks |
| --- | --- | --- |
| U-041-01 | Book-level composition/assets layout, schema, identity, retention and conflict/recovery; prove ordinary-file round trip. | T002, T003 |
| U-041-02 | Supported front/wrap output formats, fonts, dimension/color assumptions, rule versions and independent measurement tools; coordinate 035. | T004, T005 |
| U-041-03 | Optional generation/edit provider capabilities, disclosure and provenance policy; no automatic dispatch. | T006 only |
