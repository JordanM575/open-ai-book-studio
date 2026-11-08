# Tasks: task-aware model routing

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **State**: In progress; offline preview leaf implemented, production mount and broader integration remain.

Tasks are ordered by dependency; checked rows name their evidence. A decision blocks only the task
that relies on it; offline preview work does not wait for decisions about dispatch or fallback.

## Phase 0 — Resolve only the policies needed by each slice

- [ ] T001 Record a public decision for the initial author-selected writing-task taxonomy, profile
  requirements, and evidence sources. This blocks final profile data in T007 and profile-specific copy
  in T009, not the generic preview shell or unknown-state handling.
- [ ] T002 Record a public decision for whether candidates may be ranked or a single suggestion shown,
  including the evidence and deterministic policy. Until accepted, T007 and T009 must provide an
  unranked candidate list; this blocks T015, not eligibility explanations.
- [ ] T003 Decide whether a local request-size/token estimate is in scope and how its uncertainty is
  disclosed. Until accepted, T008 may show catalogue limits and prices but must not claim actual request
  fit or compute a total without known estimate inputs.
- [x] T004 Resolve D-116 and its unknown-price policy. Accepted November 7 / ADR 0019: finite
  operation mode versus qualified strict money, unknown/unresolved-charge refusal in strict mode.
  Implementation/adapter qualification remain; ordinary warnings are not upgraded into ceilings.
- [ ] T005 Record a public decision on whether a later explicit suggestion action may populate the
  existing one-turn override and whether task/route details may be persisted. Until accepted, T010 must
  remain selection-neutral and transient. This does not block a link to the existing model picker.
- [x] T006 Before any future direct dispatch, automatic routing, fallback, or retry is proposed, record
  public decisions for author authorization, stop/cancel, partial edits, uncertain charges, and recovery.
  Accepted November 7 as D-196/ADR 0019 for explicitly pinned workflow roles, zero automatic retries,
  no fallback, distinct 037 grant/admission and conservative recovery. This decision does not check
  implementation or authorize preview dispatch.

## Phase 1 — Build the local preview contract

- [x] T007 Add pure candidate-evaluation types and functions under `packages/core/src/routing/`, consuming
  existing provider catalogue/capability data. Cover known match, known exclusion, unknown requirement,
  unavailable connection, retired model, and stale catalogue with synthetic fixtures. No network, key,
  manuscript, or runtime imports.
  Implemented: `profiles.ts` (versioned `TaskProfile`/`TaskRequirements` zod schemas, no settled
  taxonomy shipped) and `evaluate.ts` (`evaluateCandidates` over per-provider catalogues,
  connections, build and optional extra ids). Status is worst-of unavailable/excluded/unknown/
  eligible with plain-language reasons; catalogue order is preserved, never ranked. Reuses the
  existing `unavailableReason`, `catalogueFreshness`, browser-availability and Contributor-warning
  copy. Covered by `packages/core/tests/routing/evaluate.test.ts` (16 pass, synthetic fixtures
  only); unknown prices stay null, the Contributor flag never changes the verdict, and a
  desktop-only provider is unavailable in the web build.
- [x] T008 Implement honest catalogue cost/context presentation rules: preserve price provenance, keep
  missing values unknown, label any supported total as an estimate, and distinguish a catalogue context
  limit from actual request fit. Any new total estimate is **Blocked on T003**; showing catalogue unit
  prices and context limits is not. Add fixture tests; do not add ceilings or cost-based request rejection.
  Implemented: `presentation.ts` (`unitPriceViews` for input/output/cached-input unit prices,
  `contextView` for the catalogue limit with always-unknown request fit). Known prices keep their
  USD-per-million values with catalogue provenance; missing or unusable prices are unknown, never
  zero — while a published zero stays known. No total, ceiling or rejection exists in the views.
  Covered by `packages/core/tests/routing/presentation.test.ts` (8 pass, synthetic fixtures only).
- [x] T009 Build the shared task-preview surface in `packages/app/` using design tokens and accessible
  status text. It must use local catalogue data, display freshness/unknowns/reasons, avoid rankings until
  T002 is accepted, and provide a path back to the existing model picker without preselecting anything.
  Implemented: `TaskPreviewDialog` (`packages/app/src/components/TaskPreviewDialog.tsx`) takes
  profiles, per-provider catalogues, connections and build as props and keeps only a transient
  selected-profile id. It renders the T007 evaluation with unranked catalogue-order candidates,
  per-candidate reasons, T008 price/context facts, per-catalogue freshness lines (new
  `catalogueAgeLine` contract), the FR-008 "No suitable candidate known." line when nothing is
  eligible, and a "Choose in the model picker" callback with no preselect. No settled taxonomy is
  shipped; profiles arrive as data. Covered by `apps/desktop/tests/task-preview.test.tsx` (7 pass:
  choose prompt, unranked statuses/reasons, facts/freshness/stale/warning, no-suitable, picker
  callback, reopen reset, no profiles) with synthetic fixtures only. Dedicated absent/malformed/
  error states stay with T011; neutrality proofs stay with T010.
- [x] T010 Keep the initial preview transient and selection-neutral. Add component tests proving open,
  profile change, close, and cancel do not change the book default, one-turn override,
  active connection, turn history, usage, or manuscript.
  Implemented: `apps/desktop/tests/task-preview-neutrality.test.tsx` (3 pass) drives the dialog
  against a fixture host through open, two profile changes, Close-button close and Escape cancel,
  asserting the host state deep-equals its snapshot and the picker callback fires once with zero
  arguments and no in-preview choice affordance. Props are frozen, and no `window.studio` mock is
  installed, so any bridge access would throw. One product fix: the picker button now calls back
  with zero arguments instead of leaking React's click event.
- [x] T011 Add no-catalogue, stale-catalogue, malformed-catalogue, no-candidate, and preview-error states.
  Each state must say what is unknown and what the author can do next; none may silently refresh, retry,
  select a replacement, or block the existing manual flow.
  Implemented: `TaskPreviewDialog` derives a `no-catalogues` / `malformed` / `error` (unreadable
  profile or failed evaluation) / `no-candidates` outcome beside the ready list, each stating what
  is unknown with the footer Close and model-picker buttons as the only next actions; a stale
  banner labels out-of-date matches without blocking them. Covered by
  `apps/desktop/tests/task-preview-states.test.tsx` (5 pass, synthetic fixtures only), asserting
  copy, enabled manual-flow buttons and no refresh/retry/select control in any state.
- [x] T012 Add provider-call and credential-access spies proving preview open/change/cancel makes zero
  new calls and reads no credentials. If an existing explicit catalogue refresh is offered nearby, test
  that it remains a separate author action and is not duplicated by the preview.
  Implemented: `apps/desktop/tests/task-preview-calls.test.tsx` (2 pass) exercises the dialog
  through open, two profile changes, the picker path and close behind a throwing bridge proxy
  and a throwing fetch stub, asserting zero bridge touches and zero fetches. A positive control
  opens the real model picker under a recording stub and asserts `providers.list` and
  `connections.list` are called, proving the spy observes real traffic. No catalogue refresh
  exists near the unwired preview, so there is nothing to duplicate.
- [x] T013 Add a Contributor-consent regression fixture: previewing a Contributor candidate never writes
  or infers `allowContributorTraining`; the existing spec 022 warning and pre-request guard remain the
  only consent behavior.
  Implemented: `apps/desktop/tests/task-preview-consent.test.tsx` (1 pass) previews a Contributor
  candidate behind the throwing bridge, asserting the exact 022 warning copy renders, no
  checkbox or switch control exists, the fixture consent flag stays false, and no bridge
  surface is touched. Consent can still change only in the 022 picker guard and pre-request
  refusal, both outside this surface.
- [x] T014 Verify keyboard use, screen-reader labels, reduced motion/transparency, and light/dark states
  for the new preview surface using the existing design system.
  Implemented: `apps/desktop/tests/task-preview-access.test.tsx` (5 pass) asserts the dialog role
  and accessible name, a named native button for every control, toggling `aria-pressed` on task
  buttons, keyboard focusability, reasons in list markup, no inline animation/transition styles
  (motion stays under the base stylesheet's reduced-motion guard), and identical structure under
  light and dark themes with token-only styling and no raw color literals. Escape-to-cancel is
  covered in T010 rather than duplicated here.

## Phase 2 — Optional, decision-gated selection integration

- [ ] T015 **Blocked on T001 and T002.** If a public ranking policy is accepted, show a deterministic
  advisory suggestion with its evidence and unknowns. Before that decision, keep candidates unranked.
- [ ] T016 **Blocked on T002 and T005.** If explicitly authorized, add a separate author action that
  hands a chosen suggestion to spec 011's one-turn override. The action must not change the book default,
  and the existing Send action remains the only trigger for a provider request.
- [ ] T017 **Blocked on T001 and T005.** If persistent task/route details are accepted, define the
  smallest versioned, non-secret record and distinguish a previewed suggestion from the actual
  model/provider recorded by spec 011. Do not store prompt or manuscript text.
- [ ] T018 **Blocked on T003 for any new total estimate; blocked on D-116 acceptance only if ceiling
  enforcement is proposed.** Verify estimates against their accepted token/price basis. Informational
  estimates do not depend on D-116; do not claim a hard ceiling from catalogue math, a warning, or a
  local reservation.

## Phase 3 — Future dispatch/fallback work is separately gated

- [ ] T019 **Blocked on T006.** Do not add direct task-router dispatch, automatic routing, fallback, or
  retry until the public authorization and recovery decisions are accepted and a separate implementation
  plan covers actual usage, uncertain charges, cancellation, and partial manuscript edits.
- [x] T020 Use only synthetic isolated fixtures for all preview, selection, and decision-record tests.
  Live-provider tests, real manuscripts, credentials, paid services, and device testing require separate
  authorization and are not acceptance evidence for this spec.
  Verified for every Phase-1 test existing now (27 routing + 24 dialog tests across 8 files):
  no `fetch`, no `LIVE_*`/environment reads, no vault/locator paths, no home-directory or
  absolute-path reads, no sample-library or temporary-directory use, no Node or network
  imports; the only `window.studio` objects are self-installed throwing bridges and one
  canned picker stub for the T012 positive control. The rule stays standing for T015–T019
  tests when those tasks unblock.
