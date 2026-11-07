# Tasks: guided and autonomous authoring

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. U-037-01/02 are accepted; implementation tasks remain pending. An open decision blocks only the dependent task named in
`spec.md`; autonomous implementation remains gated until its public decisions and contracts are
accepted.

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

## Phase 2 — autonomy decisions only; no implementation

- [ ] T012 Resolve U-037-03 and U-037-06: decide whether any autonomous authority is allowed, its
  permission/tool scope and revocation rules, and what independently testable evidence qualifies as
  verified. Record public decisions and synthetic/adversarial evaluation criteria. Review the
  constitution and AGENTS.md; if a principle changes, accept the required ADR and both amendments
  before dependent implementation.
- [ ] T013 Resolve U-037-04: define ownership, storage, versioning, conflict handling, retention,
  author review and publication rules for any future candidate. Decide explicitly whether automatic
  publication is prohibited or may be separately authorized. No candidate implementation starts
  before acceptance.
- [ ] T014 Resolve U-037-05: define worker ownership, stop/cancel, errors, close/quit, notification,
  schedule and restart/recovery contracts. Keep D-126 limited to one explicitly opted-in background
  turn; do not change current lifecycle while this remains open.
- [ ] T015 Resolve U-037-07: accept cost/duration limits and the policy for remote delivery, including
  provider-reported unknown prices. D-116 Proposed and D-129 Deferred are not authorization. This
  blocks only budgeted, scheduled or remote implementation.
- [ ] T016 After the applicable decisions and contracts are accepted, write or amend a public
  implementation spec for the selected autonomous capability, with measurable verification, failure,
  cancellation, safety, ownership and recovery behavior. No autonomous implementation or acceptance
  task may start before this gate.
