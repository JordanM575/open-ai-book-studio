# Narrator and character casting with audiobook creation

**Status:** Draft / Planned — not implemented or accepted
**Number:** 042
**Requirement:** REQ-AUDIOBOOK-001
**Depends on:** integrated 038 voice preferences and existing TTS helpers; 017 explicit background boundaries;
011/022 provider/model consent; 035 immutable export concepts; 002 checked Library writes.
030 is required only if optional character references use its new records.
**Completion lane:** L13; not a desktop release prerequisite.

## Why and user stories

Read-aloud playback is not an audiobook. An author needs explicit casting, pronunciation controls,
audition/approval, recoverable chapter rendering and packaging tied to an unchanged saved manuscript.

1. Choose a stock narrator and optional character voices, inspect provider/voice identity and audition
   only explicitly selected text before approving a cast.
2. Review chapter segmentation, pronunciation and text treatment before authorizing generation.
3. Resume failed chapters without paying to silently regenerate successful ones, then export a
   package whose contents and incompleteness are visible.

## Requirements

- **FR-001** Before each audition/render request the author MUST see provider/model, actual voice
  IDs/labels, selected snapshot text/chapters, cast, pronunciation treatment and known price facts or
  unknown cost. A provider-named action authorizes that bounded request, not future batches.
- **FR-002** A run MUST bind saved source revisions, chapter order, script segmentation, voice/cast
  versions, pronunciation settings and provider attribution. Changed text/cast makes prior audio
  stale; it MUST NOT be silently presented as a rendering of current text. Audio determinism across
  provider calls is not promised.
- **FR-003** Character dialogue assignment MUST be author-reviewable and editable before sending;
  ambiguous/unassigned passages MUST be flagged or use an explicitly approved narrator policy.
  No inferred character identity authorizes third-party voice imitation or cloning.
- **FR-004** Generated assets and run metadata MUST be ordinary recoverable files under an accepted
  layout, published only by checked atomic Library operations. Manuscript/source assets MUST NOT be
  modified. Originals, unknown metadata and conflicting cast edits MUST be preserved.
- **FR-005** Cancellation MUST stop further sends best-effort and state that already sent text and
  incurred charges cannot be recalled. Chapter states MUST distinguish pending, rendering, complete,
  failed, cancelled and stale. Partial output MUST NOT be labelled a complete audiobook.
- **FR-006** Resume MUST reuse validated successful assets from the exact source/cast run. Retrying
  a failed/uncertain request needs explicit consent and disclosure of duplicate-charge risk; no
  silent retry, fallback, voice substitution or regeneration. Hard spend caps require an accepted
  separate enforcement contract; D-116's proposal does not supply one.
- **FR-007** Export MUST identify included chapters/order, voices/provider, source revisions,
  generated-voice disclosure, output format and measured audio facts/unknowns. Packaging MUST
  preserve prior destinations on failure and warn/refuse incomplete output as defined by the output
  decision. No distributor acceptance without its named rule-set checks.
- **FR-008** Stock licensed voices only in initial scope; no cloning, real-person imitation or
  ownership guarantee. A removed/unavailable voice MUST block the affected request, not substitute.
- **FR-009** Credentials stay in the privileged provider service, not audio metadata/logs/library.
  Source/profile/instructions are untrusted data. Unsupported hosts MUST refuse before private
  reads, provider requests or recording. Keyboard controls and text alternatives remain available.

## Acceptance scenarios

Use synthetic chapters, generated test tones and mocked speech transports.

1. Cancel before audition/render: zero calls. Approve two chapters: captured payload equals disclosed
   text/cast/pronunciation and contains no other manuscript or secret. Original file hashes match.
2. Change source/cast or remove a voice: affected assets show stale/unavailable; no silent fallback.
   Ambiguous dialogue requires approved assignment before a request.
3. Fail/stop chapter two after chapter one completes, then restart: valid chapter-one asset is reused;
   chapter two needs explicit retry. An uncertain request warns of duplicate charges. No complete
   package is claimed from the partial run.
4. Corrupt output, disk-full, conflict and export failure preserve original manuscript and prior
   destinations. Run metadata and valid audio recover after restart under the accepted layout.
5. Inspect exported manifest/order/disclosure and independently measure the chosen audio properties.
   Unknown measurements do not pass a distributor check. Keyboard/host-refusal/redaction tests pass.

## Non-goals

Voice cloning, third-party imitation, live conversation, automatic dialogue casting approval,
background/standing generation authority, autonomous spending, storefront upload, guaranteed
bit-identical regenerated audio or replacing 038's general playback preferences.

## Open decisions

Record accepted architecture in docs/DECISIONS.md and an ADR before dependent implementation.

| ID | Question / evidence | Blocks |
| --- | --- | --- |
| U-042-01 | Cast/script schema, character IDs, pronunciation and segmentation model; verify attribution and ambiguity handling. | T002, T003 |
| U-042-02 | Asset/run layout, checked publication, restart/uncertain-job recovery, retention and deletion; fault-test provider and filesystem boundaries. | T004, T005 |
| U-042-03 | Speech-provider capability/stock-voice availability, disclosure, price freshness and bounded batch consent; reconcile 038 without creating automatic spend authority. | T003, T005 |
| U-042-04 | Output formats, manifest, incomplete-export policy and measurable audio/distributor rules; independent measurement evidence. | T006 |
