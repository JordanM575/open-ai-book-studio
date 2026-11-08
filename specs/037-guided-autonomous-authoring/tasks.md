# Tasks: guided and autonomous authoring

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered by their actual prerequisites. D-193 and D-194–D-196 accept the foreground and
full-book contracts; reviewed shared storage/host integration remains required before execution.
Decision completion does not check implementation tasks.

W10 (2026-11-07) implements the pure envelope/citation/read-facade portions in new core leaf modules;
see the plan's implementation slice. No whole runtime/UI task below is completed by those modules.

## Phase 0 — settle the Phase 1 contracts

- [x] T001 Resolve U-037-01: agree and record the exact source payload, pre-send disclosure and local
  conversation-record behavior for a model review. This blocks only the provider request and
  disclosure work in T004–T005. Accepted in D-193 / ADR 0018 (November 7): immutable explicit source
  envelope and snapshot-only tools; conversation-safety integration precedes new durable parts.
- [x] T002 Resolve U-037-02: agree and record the author-visible citation location and revision
  contract, including how the shared library detects a changed source. Accepted in D-193 / ADR 0018:
  exact source token plus UTF-16 span/quote and derived human labels. T006–T007 still implement it.

## Phase 1 — foreground, read-only guidance

- [ ] T003 Add a foreground review entry point for an author-selected passage or chapter and optional
  explicitly selected sources. Keep it in the existing agent conversation and lifecycle; do not add a
  background control or change close, quit or notification behavior.
- [ ] T004 After T001, show the selected connection/provider, model and exact source scope next to an
  explicit provider-named review action. Verify existing connection, model capability and consent
  checks run before any request; do not silently switch provider or model.
- [ ] T005 After T001, send only the disclosed selected content and explicit sources. A cancel before
  starting the action must send nothing. Use the existing provider path; do not add a proxy or new
  credential store.
- [ ] T006 After T002, capture the source revision and render each source-backed observation with an
  author-readable, resolvable citation. Do not display internal IDs, hashes or raw tool payloads.
- [ ] T007 After T002, compare the captured source revision with the current source before presenting
  the response as current. Mark changed/missing sources stale or unavailable and offer an explicit
  rerun without refreshing silently.
- [ ] T008 Restrict the review turn to enabled built-in `read`-tier tools. Exclude plugins, writes and
  destructive tools, and enforce the refusal at execution time as well as at model tool selection.
  Respect the selected scope and the book's disabled-tool settings.
- [ ] T009 Implement stop, refusal, provider failure and source-read failure states. Preserve the
  prompt/scope for retry, identify incomplete work, release the busy state and leave every manuscript
  file unchanged. Explain that already-sent content cannot be recalled.
- [ ] T010 After T001–T009, add synthetic isolated-fixture tests for request scope/disclosure, cancel-before-send,
  read-only enforcement, untrusted manuscript/tool text, valid citations, stale revisions and failure
  paths. Assert fixture files remain byte-identical; do not use real manuscripts, credentials or live
  providers.
- [ ] T011 Check the review journey with keyboard-only and accessible status announcements. Verify the
  configured provider, source scope, stale state, stop and retry actions are understandable without
  relying on color or raw identifiers.

## Phase 2 — accepted autonomy decisions

- [x] T012 Resolve U-037-03 and U-037-06: decide whether any autonomous authority is allowed, its
  permission/tool scope and revocation rules, and what independently testable evidence qualifies as
  verified. Record public decisions and synthetic/adversarial evaluation criteria. Review the
  constitution and AGENTS.md; if a principle changes, accept the required ADR and both amendments
  before dependent implementation.
- [x] T013 Resolve U-037-04: define ownership, storage, versioning, conflict handling, retention,
  author review and publication rules for any future candidate. Decide explicitly whether automatic
  publication is prohibited or may be separately authorized. No candidate implementation starts
  before acceptance.
- [x] T014 Resolve U-037-05: define worker ownership, stop/cancel, errors, close/quit, notification,
  schedule and restart/recovery contracts. Keep D-126 limited to one explicitly opted-in background
  turn; do not change current lifecycle while this remains open.
- [x] T015 Resolve U-037-07: accept cost/duration limits and the policy for remote delivery, including
  provider-reported unknown prices. D-116 Proposed and D-129 Deferred are not authorization. This
  blocks only budgeted, scheduled or remote implementation.
- [x] T016 After the applicable decisions and contracts are accepted, write or amend a public
  implementation spec for the selected autonomous capability, with measurable verification, failure,
  cancellation, safety, ownership and recovery behavior. No autonomous implementation or acceptance
  task may start before this gate.

T012–T016 resolved November 7 in D-194–D-196/ADR 0019, this spec/plan and the accompanying
constitution/AGENTS amendment. D-116 now selects two modes; D-126 retains ordinary per-turn policy
with an explicit 037 exception. Earlier open/Proposed phrasing above is the historical task question.

## Phases 3–12 — full-book implementation and evidence

- [x] T017 Record the individual authority/lifecycle/admission/evidence amendments (ADR 0019).
- [ ] T018 Specify and review every workflow/thread/host-permission wire schema in FORMAT before writers.
  **Partial (2026-11-07):** workflow record schema 1 — run/brief/policy/plans/directions/tasks/
  command journal/attempts/effects/questions/artifacts/contexts/admission records — is specified in
  FORMAT with a pure raw codec in `packages/core/src/authoring/wire.ts` and synthetic round-trip/refusal
  tests. Shared thread migration, host-permission schemas, checked writers, real streaming and
  independent review remain; T018 stays open.
- [ ] T019 Implement checked/lossless shared threads, explicit migration, recoverable deletion and all callers.
- [ ] T020 Integrate truthful stop settlement, consumer/persistence warnings and pinned-Library quiescence.
- [ ] T021 Implement pure versioned graph, dependency/direction invalidation, command identity and reducers.
  - Partial implementation evidence (November 7): isolated `packages/core/src/authoring/` provides
    validated immutable DAG/reference contracts, exact command replay checks, question/direction
    invalidation, historical late outcomes and distinct attempt/effect settlement. Focused adversarial
    tests live in `packages/core/tests/authoring/`; no wire writer or host execution is exposed.
  - Independent F1/F2 follow-up preserves depth64 records through aggregate wrappers and validates
    Continue clocks before property access. Cross-transition regressions accompany the correction;
    fresh exact-head independent review remains required and this broad task stays unchecked.
    Local correction gates:83 focused tests, strict source/test and platform-independent checks,
    workspace typechecks and warning-free scoped lint; no writer/host/full-book evidence inferred.
- [ ] T022 Implement host permission and durable finite admission/reservations, including unknown charges.
  - Pure portion only: finite reservation/accounting decisions, injected clock/account facts, strict
    qualified-maximum versus bounded-operation cost modes, and generation changes preserving budget
    history. Host permission, durable storage and adapter qualification remain required.
- [ ] T023 Implement immutable artifact/context and checked run/task/attempt/effect/question storage.
- [ ] T024 Add scoped attempt execution at the existing runtime seam; no ordinary full-book prompt/plugins.
- [ ] T025 Add event-driven asynchronous scheduling, account limiter, zero automatic retries and no spin.
  - Pure portion only: ready/blocked/settling projections, pinned-route capacity decisions, no-progress/
    revision ceilings and rate-limit eligibility without resend. Actual asynchronous scheduling,
    host serialization, held-transport overlap and runtime integration remain unimplemented here.
- [ ] T026 Mount small optional New book onboarding, exact brief/choices/agreement and real 033 goal.
- [ ] T027 Run independent outline/cast proposals, reconcile them and record initial author direction.
- [ ] T028 Execute incremental scene/chapter assembly, bounded completion and causal dependencies.
- [ ] T029 Publish through one checked Library effect/safety path with first-keystroke target protection.
- [ ] T030 Run separate developmental and line/continuity reviewers with exact candidate/saved citations.
- [ ] T031 Retain bounded revision/recheck lineage and integrate exact current-source underlines.
- [ ] T032 Add durable question inbox, adoption-based cadence and checked versioned author answers.
- [ ] T033 Invalidate affected tasks on direction change; prove independent continuation and stop precedence.
- [ ] T034 Wire hidden-window/sleep/quit/connection-revoke handling and privacy-preserving notifications.
- [ ] T035 Reconcile in a fresh process; default no sends, opted-in safe resume, uncertain effects blocked.
- [ ] T036 Complete hierarchical whole-book source/category coverage, boundary review and synthesis.
- [ ] T037 Show final handoff with verified saved target, completed chapters/ending and remaining decisions.
- [ ] T038 Connect typed hands-free check-in/control intents under 017/ADR 0021 without implicit capture.
- [ ] T039 Pass independent protocol/fault tests: simultaneous workers, every crash window, stale/foreign
  state, duplicates, quota/unknown charge, overflows, manual edits and archive/trash preservation.
- [ ] T040 Pass actual hidden-app brief→pipeline→~70k saved words with revisions/check-ins/restart;
  retain exact hashes, request/worker counts and coverage. Preseeded output is insufficient.
- [ ] T041 Define a literary-quality rubric before separately authorized live long-form evaluation;
  independent readers assess complete original/revised books and limitations. No paid run authorized now.
- [ ] T042 Record usability, keyboard/performance and actual platform/voice/device evidence separately;
  preserve 038 T022 and all release-approval boundaries.
