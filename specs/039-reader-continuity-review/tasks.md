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
- [ ] T012 Implement a minimal CodeMirror plain-text surface/current-source handle with the existing one
  undo owner; prove canonical roundtrip, no writes on navigation, IME/paste/voice and save fidelity.
- [ ] T013 Mount accessible findings/sidebar/underlines/filters; hide current marks on edit, preserve
  historical explanations, handle overlaps/repeated passages and asynchronous navigation ABA.
- [ ] T014 Specify field-level report/profile/disposition/campaign and continuation formats/recovery first.
- [ ] T015 Implement explicit save, recoverable related-file trash/restore, archive and safe Markdown export;
  stale no-op, collision, readback/disk-full/partial-save tests, no eviction or silent truncation.
- [ ] T016 Add one exact suggestion preview/apply, isolated undo, checked save and truthful receipt;
  composition/dirty/source-change/conflict/duplicate application cannot bypass the writer.
- [ ] T017 Add a pure all-range campaign planner, versioned source/category union coverage, boundary and
  attributed synthesis stages; test 70k/250k/oversized chapters under all per-request bounds.
- [ ] T018 Integrate campaign/check-in artifacts into the separately authorized 037 coordinator.
- [ ] T019 Measure the connected journey's accessibility, fidelity and existing performance/bundle gates;
  separately evaluate semantic usefulness before any model-quality claim.

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
