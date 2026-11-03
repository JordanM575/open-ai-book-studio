# Plan: guided and autonomous authoring

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Shape

Deliver Phase 1 as a foreground mode of the existing agent, not as a second agent runtime or report
engine. Reuse the configured provider/model path, the studio-owned tool catalog and the open Library.
Keep the review turn read-only at both tool selection and execution boundaries. The only initial
network activity is the provider request the author explicitly starts after seeing its destination and
source scope.

The likely implementation seams are:

- `packages/app` for the author-facing review entry point, scope disclosure, citations, stale state,
  stop and retry behavior.
- `packages/core/src/agent/` and the existing agent tool catalog for the review-turn contract and
  read-only allowlist. The allowlist must respect 024 tiers and 025 per-book tool controls.
- `apps/desktop/src/main/agent/runtime.ts` and existing provider/model services for the foreground
  request. Provider credentials stay in main; renderer requests continue through the validated
  preload/IPC boundary.
- Shared library read results for source revision capture and comparison. Use the existing version
  discipline internally; render author-readable citations rather than internal identifiers.
- Synthetic core, component and mocked-runtime tests for data scope, tool refusal, stale sources,
  cancellation and failure. No real provider or manuscript is needed for these contracts.

Confirm exact module names and ownership during implementation; this plan does not authorize a new
storage format, backend, plugin boundary or write path.

## Request and safety flow

1. The author chooses the passage/chapter and any additional sources. The interface identifies the
   configured provider and model and discloses what source content will be sent.
2. The provider-named review action starts one foreground turn. The request uses the selected
   connection/model and existing provider consent and capability checks; there is no silent fallback.
3. The runtime exposes only enabled built-in tools with the `read` tier. Tool execution independently
   rejects writes, destructive tools, plugins and reads outside the approved scope.
4. Each source read returns its revision with the source. The answer carries citations tied to that
   snapshot. Before the answer is treated as current, compare the current source revision; changed or
   unavailable sources produce a visible stale/unavailable state and an explicit rerun option.
5. Stop, provider failure or a read failure leaves files unchanged and the request retryable. Existing
   thread persistence is reused; no review report or candidate file is introduced.

The precise payload/disclosure contract (U-037-01) and user-visible citation/revision contract
(U-037-02) must be resolved before their dependent tasks. They do not block independent UI framing or
synthetic contract tests.

## Boundaries and dependencies

- 002 remains the manuscript, turn, provider-disclosure and untrusted-data contract.
- 011 remains the provider/model/consent authority. A review cannot weaken its gates or change the
  selected connection.
- 024 remains the single catalog and tool-tier source. No parallel set of review tools is introduced.
- 025 plugin loading remains unchanged; plugins are excluded from Phase 1 review turns even when
  configured for ordinary agent work.
- D-126 remains a one-background-turn opt-in. Phase 1 adds no background switch and changes no
  notification, window-close or quit behavior.
- Spec 034's deterministic structured report remains separate. No score, report schema or export is
  added here.

## Gated future work

Autonomy is not a later phase that can start merely because Phase 1 ships. Before any autonomous
implementation, resolve the dependent U-037 decisions, record accepted public decisions, agree the
verification evidence, and approve ownership/recovery contracts. Review the constitution and AGENTS.md;
where a principle changes, land the required ADR and amendment before implementation. Decide scope,
tool authority, candidate ownership/publication, lifecycle, recovery, budgets and remote delivery
separately. The D-126 boundary does not answer those questions.

Once those gates are resolved, write or amend a public implementation spec with the accepted behavior
and tasks. Until then, autonomy tasks in `tasks.md` are decision work only; they do not authorize
workers, candidates, schedules, notifications, automatic publication, restart behavior, budgets or
remote delivery.

## Verification approach

- Use synthetic isolated books and mocked library/provider boundaries only.
- Assert that the provider-bound payload matches the visible, author-selected scope; a pre-send cancel
  makes no request.
- Assert that only enabled built-in read tools are registered and callable, and that prompt-injection
  text in manuscript/tool output cannot widen scope or enable a write.
- Exercise source changes, missing sources, provider refusal, tool failure and stop; fixture files must
  remain byte-identical and the request must remain retryable.
- Resolve every displayed citation against its captured source revision. Do not claim semantic review
  quality from citation-resolution tests; U-037-06 defines the evidence required for future autonomy.
- Do not run live-provider, real-manuscript, credential, paid-service or device checks under this spec.
