# Tasks: structured reader and continuity review

D-193 and D-197–D-199 are accepted. Isolated implementation/review evidence does not complete the
mounted journey. W10 implements T002's leaf contracts and focused synthetic tests; no whole runtime/UI
task is completed. T010 retains the independent correction gate. The policy amendment completed T007.

- [ ] T001 Reconcile 034/037 contracts, existing evidence and exact owned modules; record acceptance scope.
- [x] T002 Apply accepted D-193 / ADR 0018 for U-039-01/02; define and test finding, profile/version and run contracts. W10: new `review/profiles.ts`, `wire-schema.ts`, `findings.ts` and `scoped-readers.test.ts`; pure, volatile contracts only.
- [ ] T003 Apply accepted U-039-04 / D-193 bounds; build disclosed selected-source snapshots, pre-start known/unknown price and data-use/training terms, mandatory 011/022 consent gates, and provider-named start with zero-send cancel/missing-consent tests.
- [ ] T004 Add schema and quotation validation, citation navigation and stale/unavailable states.
- [ ] T005 Add volatile profile attribution and explicit rerun comparison without replacing prior results.
- [ ] T006 Add explicit multi-book manuscript scope and, only after 030 contracts, optional planning sources.
- [x] T007 Resolve U-039-03 / D-171 applicability; accepted November 7 as D-199 / ADR 0020, with
  explicit-save/recovery plan below. No storage implementation is claimed by this task.
- [ ] T008 Prove read-only enforcement, injection resistance, overflow, stop, failure and no automatic retries with mocked transports and file hashes.
- [ ] T009 Verify built-app keyboard/theme/reduced-motion/reduced-transparency/unsupported-host journeys; run exact-head tests/typecheck/smoke and record limitations in the index/changelog.

## Inline, retained and whole-book follow-through — ADR 0020

- [ ] T010 Correct and independently re-review the existing scoped core/UI boundary findings before integration.
  - Coordinator correction covers registered-envelope evidence, plain/lossless input and canonical
    data, strict current facts, malformed-Unicode overflow, sparse terms, malformed callback reasons
    and same-view cancellation ownership. Focused regression files accompany the change; fresh
    independent exact-head review and mounted/runtime gates remain required.
- [ ] T011 Add shared exact-source/evidence identity, complete overlap index, disposition and rerun relations.
  - Partial evidence: `packages/core/src/review/shared-verifier.ts` with
    `packages/core/tests/review/shared-verifier.test.ts` verifies one saved-chapter
    snapshot from raw bytes/text, reuses the accepted envelope/citation/overlap
    contracts and returns a frozen inline layer or a bounded refusal. Disposition and
    rerun relations, host mounting/export and independent review remain open, so this
    task stays unchecked. 038 T022 remains unchecked.
- [ ] T012 Implement a minimal CodeMirror plain-text surface/current-source handle with the existing one
  undo owner; prove canonical roundtrip, no writes on navigation, IME/paste/voice and save fidelity.
  - November 8: the accepted surface is now mounted inside `ManuscriptEditor` with the wrapper's one
    undo/save/draft owner, an automation contract that preserves the `manuscript-text` smoke hooks,
    and focused parity tests (typing, Enter, paste, dictation, selection, save/undo/redo commands,
    composition and hold guards, conflict retention, flush). The full mounted accessibility,
    native-IME, provider and performance acceptance is still open, so this task stays unchecked.
- [ ] T013 Mount accessible findings/sidebar/underlines/filters; hide current marks on edit, preserve
  historical explanations, handle overlaps/repeated passages and asynchronous navigation ABA.
- [ ] T014 Specify field-level report/profile/disposition/campaign and continuation formats/recovery first.
- [ ] T015 Implement explicit save, recoverable related-file trash/restore, archive and safe Markdown export;
  stale no-op, collision, readback/disk-full/partial-save tests, no eviction or silent truncation.
- [ ] T016 Add one exact suggestion preview/apply, isolated undo, checked save and truthful receipt;
  composition/dirty/source-change/conflict/duplicate application cannot bypass the writer.
- [ ] T017 Add a pure all-range campaign planner, versioned source/category union coverage, boundary and
  attributed synthesis stages; test 70k/250k/oversized chapters under all per-request bounds.
  - November 8, W10 v19: new pure `review/campaign-planner.ts` and `campaign-coverage.ts` implement
    explicit scalar-safe all-range planning, existing-envelope admission, bounded attributed synthesis
    reservations/actual-input admission, and exact revision/category/profile union coverage. Dedicated
    synthetic tests include 70k/250k single chapters and a 120-chapter/250k selection. Oversized durable
    plans remain whole and explicitly non-persistable under existing 64-source/64-stage limits.
    `review/CAMPAIGN-README.md` names continuation-format, lossless persistence mapping and execution
    prerequisites. T017 stays unchecked pending fresh independent exact-head review; these checks
    provide no host/provider-quality/device/release evidence and do not complete T018/T019.
  - November 8, v21 correction: the immutable plan/digest now retains the chosen owning book, with
    equal-length cross-owner receipt/summary refusal tests. Shared plain-data validation memoizes
    completed objects per call to avoid exponential malformed DAG traversal while preserving active
    cycle, accessor and lossy-value rejection. Fresh independent review remains required.
  - November 8, synthesis follow-through: individually validated evidence windows now sort/union
    inside their selected segments, preserving scalar boundaries, exact original text/line numbers
    and all genuine gaps. Generated summary-feedback IDs avoid selected-history collisions with
    deterministic bounded suffixes; actual admission retains every history field and dependency.
    Positive interval/citation/ID-collision regressions accompany both review corrections. T017 and
    connected host/continuation/provider acceptance remain open pending fresh exact-head review.
- [ ] T018 Integrate campaign/check-in artifacts into the separately authorized 037 coordinator.
- [ ] T019 Measure the connected journey's accessibility, fidelity and existing performance/bundle gates;
  separately evaluate semantic usefulness before any model-quality claim.

### November 8 — pure D-201 continuation candidate (T014/T017 partial)

`packages/core/src/review/campaign-continuation-*` now supplies pure in-memory manifest, segment,
checkpoint and publication-intent candidate/inspection primitives. Encoding requires a locally
provenanced plan; hole reconstruction remains untrusted, and complete comparison with a separately
supplied local plan does not register the decoded object. Focused synthetic tests cover large real
planner fixtures, exact content/union, token and byte boundaries, unknown data and tampering. The
standalone resolver does not independently establish all plan semantics, source-file identity or
verified reports. Compatible replanning, storage publication/recovery, adapter qualification,
cross-book report resolution, host integration and independent exact-head review remain open.
T014/T017/T018 stay unchecked; 038 T022 is unchanged.

### November 8 — D-201 conditional continuation specification (T014 partial)

D-201 and the ADR 0020 amendment accept the conditional schema-2 campaign format; `docs/FORMAT.md`
links its field-level schema, bounds, external holes, provenance and recovery rules in
`docs/formats/campaign-continuation.md`. This is a documentation/decision slice only: no continuation
codec, compatible-replan seam, writer, adapter capability, group move or 037 host integration was
implemented or validated here. The focused planner baseline could not load `zod` because prepared
workspace dependencies were absent. Independent implementation/review and the remaining format,
execution and integration gates stay open. T014/T017/T018 remain unchecked; 038 T022 is unchanged.

### November 8 — saved review records, schema 1 (T014/T015 partial)

`packages/core/src/review/record-json.ts` and `record-format.ts` define the field-level schema-1
report, disposition, author-lens and campaign records; `record-store.ts` is the only writer and is
constructed as `LibraryService.reviewRecords`. Reports are immutable and absent-only; the other
records carry the exact previous raw hash and revision, keep conflict copies, verify readback, join
the Library queue/journal, restore from grouped `.studio/trash` only into free paths, and never
prune. Unknown plain fields survive read-modify-write; newer or unknown semantics stay read-only.
`docs/FORMAT.md` records the fields and bounds.

Candidate-local evidence: `packages/core/tests/review/record-format.test.ts` and
`record-store.test.ts` (synthetic). Still open: segmented continuation, IPC/preload/UI mounting,
Markdown/archive export, campaign scheduling/execution, cross-book campaign aggregation and fresh
independent exact-head review. T014 and T015 stay unchecked. 038 T022 is unchanged.

### November 7 — bounded T011/T012 editor candidate

The new `packages/app/src/components/inline-editor/` leaf and
`packages/core/src/review/inline/overlap.ts` provide a minimal unmounted plain-text
adapter, exact-current snapshot/final post-await gate, trusted evidence-port seam,
complete overlap membership and keyboard/pointer inspection callbacks. Existing
ManuscriptEditor and its save/draft/custom-history owner remain unchanged.

Candidate-local evidence: 20 new focused tests; 64 tests / 801 assertions including
the existing editor/history/failed-save/move-rebase regressions; nine hidden native
Chromium fidelity probes, strict desktop/web/toolkit typechecks and focused lint.
The local README records APIs, migration steps, MIT dependency notices, bundle
measurement procedure and native partial-grapheme selection/clipboard differences.
This is **partial T011/T012**, not a checked task: the corrected shared verifier,
disposition/rerun relations, mounted save fidelity, accessible full sidebar and
whole-product performance/license/bundle gates still need their named owners and
independent exact-candidate review. No mounted T013 or saved/application completion
is inferred from the isolated controls or synthetic proof port.

### November 8 — W10 v19 saved-record API and Workspace inspection (T015 partial)

`library/review-record-api.ts` adds bounded request/reply validation, per-request nonce/digest and
Library/book/view binding, explicit immutable reader saves, exact-hash report reads, bounded report
and unavailable-file pages, and report-bound disposition inspection. The browser adapter uses the
current Library service. Workspace mounts Saved reviews; the structured result leaf has an explicit
Save review control with no provider dispatch. Local choices/notes and inspected feedback survive
failed reads/refused saves; historical quotes are labelled verified-at-capture, never current.

Focused synthetic tests exercise the actual browser adapter and mounted Workspace, registered
desktop IPC/preload with an injected filesystem LibraryService, same-ID no-op, conflict `savedAs`,
refusal/not-kept/uncertain results, malformed/foreign/late/ABA replies, missing API, draft retention
and unchanged original chapter hashes. Desktop's actual `Library` wrapper lacks the forwarding
getter and is tested to refuse. Its addition remains coordinator-owned. The store also lacks
caller-base-checked disposition mutation and exact-inspection trash/recovery APIs; those controls
remain explicitly unavailable rather than using a racy read-before-write substitute. No complete
mounted recovery or persisted disposition-save journey is claimed. Production reader execution,
Markdown/export/archive acceptance, native accessibility and fresh exact-head review remain open.
T014/T015 and all other task checkboxes stay unchanged; 038 T022 stays unchecked.

### November 8 — W10 v20 checked disposition and recovery continuation (T015 partial)

The explicitly expanded store/desktop ownership closes v19's three seam prerequisites: desktop
forwards the current Library service, `recordDispositionChecked` consumes inspected raw report and
disposition bases in the existing queue, and one-use inspected group confirmation drives bounded
trash inspection and free-path restore. Complete stale histories/unknown own fields survive as
checked conflict copies; transport edges validate complete success/conflict outputs. The mounted
Workspace journey retains exact drafts on failure/uncertainty, prevents replay until inspection,
and retires late/foreign/ABA replies. Partial moves are uncertain and remain recoverable, including
disposition-only groups bound to an exact active report. FORMAT and the reader README describe the
contract before exposure; no second writer or provider dispatch was introduced.

Candidate-local automated evidence covers actual desktop wrapper/IPC/preload, browser Library/API
and mounted save/reopen/trash/restore, competing/missing/replaced bases, future/unavailable records,
occupied targets, partial/concurrent moves, uncertain receipts, unknown fields and unchanged
synthetic manuscript hashes. Production selected-source execution, safe Markdown export, archive
acceptance, segmented continuation, campaign execution, native accessibility, broad integrated
gates and fresh independent exact-head review remain open. T014/T015 stay unchecked; 038 T022 is
untouched. Final focused evidence: 147 tests / 898 assertions across six dedicated/relevant files,
workspace typechecks, strict core-test typecheck, ten-file lint and diff checks passed. Detailed
executed commands and limits are in the separate v20 finish report.

### November 8 — W10 v21 saved-review recovery corrections (T014/T015 partial)

Report conflicts now require full reconstructed intended content, verified conflict metadata and
independent reads of the named copy at the handler and receiver; an unverifiable copy or publication
stays uncertain. Pending and uncertain report saves survive equivalent prop wrappers and require
same-view inspection and explicit acknowledgement before another save. Disposition drafts retain
newer typing but cannot use a known or possibly superseded baseline without inspection and explicit
history adoption, including other drafts around an unconfirmed save; untouched blank notes are absent,
while explicit empty and whitespace notes remain exact. Caller-owned
disposition inputs are admitted before property reads. Desktop tests use the shared complete Electron
mock and portable, individually owned temporary roots.

Focused synthetic store/transport, mounted browser and mocked desktop wrapper/IPC/preload regressions
exercise these corrections and their uncertainty paths. They do not establish built Electron or native
device behavior, nor close production reader execution, export/archive, segmented continuation,
campaign, accessibility, broad integration or fresh independent exact-head review. T014/T015 stay
unchecked and 038 T022 is unchanged. Exact commands, results and limits belong to the separate v21
recovery finish report.
