# Structured reader and continuity review

**Status:** Draft / Planned — initial contracts accepted under D-193; implementation and full acceptance pending
**Number:** 039
**Requirement:** REQ-REVIEW-003
**Depends on:** 034 saved-source evidence contracts; 037 scoped read-only provider review;
011/022 provider consent and capability contracts; 030 for optional series records.
**Completion lane:** L09. These are contract dependencies, not a requirement to finish every task
in the referenced specs. Advisory routing in 036 is optional; automatic dispatch is not required.

## Why

An author needs structured critique from named reader perspectives, repeat reviews that preserve
their attribution, and continuity findings grounded in explicitly selected books. These subjective
model reports must not masquerade as deterministic metrics (034) or conversational guidance (037).

## User stories

1. Choose a reader profile and selected saved chapters, inspect the provider/model and outgoing
  scope, known price or unknown cost and applicable data-use/training terms, and request a
  suggestion-only alpha/beta report.
2. Inspect a finding's verified quotation and revision; distinguish evidence from interpretation.
3. Reread changed chapters without overwriting or relabelling the earlier reader/run.
4. Select multiple books for continuity analysis and see which manuscript, outline or note supports
   each claimed inconsistency. A missing source is insufficient evidence, not proof of a plot hole.

## Requirements

- **FR-001** Each run MUST disclose provider, model, profile/version, selected saved sources and
  any prior feedback sent, known price facts or unknown cost, and applicable provider data-use and
  training terms before start. Existing 011/022 consent gates remain mandatory, including 022's
  default-off book-level training consent where applicable; absent consent MUST block the request.
  A provider-named start authorizes only that run; pre-start cancel sends nothing. No silent model
  fallback, additional book reads or background rereads are permitted.
- **FR-002** The boundary MUST enforce selected-source reads and exclude write, destructive,
  disabled and plugin tools. Manuscripts, profiles and earlier feedback are untrusted data and
  cannot widen permissions. All manuscript bytes MUST remain unchanged on every outcome.
- **FR-003** A schema-validated finding MUST identify its category, reader/run, interpretation,
  source kind, book/chapter, captured revision and resolvable location. Quoted text MUST match the
  supplied snapshot; invalid citations MUST be withheld as unverified rather than fabricated.
- **FR-004** Reader impressions and style suggestions MUST be labelled subjective. No model score
  is an objective quality measurement. Deterministic results remain separately labelled under 034.
- **FR-005** Revisions MUST be compared before showing a report as current. Missing/changed sources
  produce unavailable/stale evidence, never silent refresh. Cross-book scope MUST name every book
  and distinguish manuscript evidence from planning records. No library-wide scan is implicit.
- **FR-006** Rerun comparison MUST attribute both runs, their source revisions and profile versions.
  It MUST distinguish changed input from changed interpretation; it MUST NOT overwrite prior feedback.
- **FR-007** Stop, malformed output, refusal, context overflow and provider failure MUST end with an
  honest incomplete/failed state and retryable scope. Already sent data cannot be recalled; retries
  need a fresh author action and may incur cost. Unknown cost stays unknown; D-116 is not a hard cap.
- **FR-008** Reports are volatile until the retention/storage decision below and D-171's applicability
  are settled. No separate history, export or profile store is authorized by this draft. Any approved
  persistence MUST use ordinary recoverable files, Library-only atomic version/hash-checked writes,
  preservation of unknown fields and an explicit deletion/retention contract.
- **FR-009** Unsupported hosts MUST refuse before reading private content or calling a provider.
  The UI MUST support keyboard use, light/dark and reduced-motion/transparency preferences.

## Acceptance scenarios

Use isolated synthetic books and mocked transports, not paid calls or real manuscripts.

1. Cancel before start: zero provider requests and byte-identical library. Start one selected chapter:
   the captured request contains exactly the disclosed scope, with no adjacent chapter or secret.
   Known/unknown price and applicable data-use/training terms are shown before start; missing required
   011/022 consent produces zero calls and cannot be bypassed by a reader profile or rerun.
2. Inject instructions in prose, profile and prior feedback: no expanded reads, writes or plugin calls.
3. Supply valid, invented and wrong-revision quotations: only valid snapshot matches resolve as
   evidence. Change/delete a source mid-run: mark stale/unavailable and require an explicit rerun.
4. Run two profiles and two revisions: identity/version attribution survives comparison; no earlier
   run is relabelled. Selected cross-book findings name each source and its manuscript/planning kind.
5. Stop, overflow, refusal and malformed output leave files unchanged, release busy state and show
   incomplete coverage; no automatic retry or fallback occurs.
6. Keyboard-only scope selection, finding navigation and stop work on the claimed desktop host;
   an unsupported host sends nothing. Reduced-motion and reduced-transparency preferences are
   exercised explicitly. Persistence spies observe no report/history writes.

## Non-goals

Applying suggestions; autonomous edits or background agents; objective literary rankings; a new
provider runtime; automatic routing; real-reader impersonation; settling 030's series storage.

## Open decisions

D-193 / [ADR 0018](../../docs/adr/0018-scoped-review-contracts.md) resolves the initial source, quote,
profile and overflow contracts. Persistence remains a separate decision. Accepted policy is not
implemented behavior; amendments are required if constitutional boundaries change.

| ID | Question / required evidence | Blocks |
| --- | --- | --- |
| U-039-01 | Accepted D-193: exact selected-source UTF-16 spans/quotes, no normalization/fuzzy matching, derived verification and bounded subjective findings. | T002/T004 implementation remains |
| U-039-02 | Accepted D-193: fictional Alpha/Beta lenses, immutable IDs/versioned edits, full per-run snapshots and separate source/profile/provider change attribution. No completed user study is claimed. | T002/T005 implementation remains |
| U-039-03 | Volatile versus saved report/profile history, retention, export and deletion; reconcile D-171 before defining any layout. | Persistence only; T007 decision work |
| U-039-04 | Accepted D-193: four books/64 items, 65,536 source-text bytes, 131,072 combined content bytes, 262,144 complete request/output bytes. Bounds are not token-fit claims; overflow refuses without clipping/splitting/fallback. Single-book work uses the same policy. | Remains prerequisite for T003/T006 implementation; no single-book exemption |
