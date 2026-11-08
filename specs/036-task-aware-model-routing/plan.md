# Plan: task-aware model routing

**Spec**: [spec.md](spec.md) · **Status**: Draft / Planned  
**Public dependencies**: [011](../011-model-access/spec.md), [022](../022-provider-compatibility/spec.md), [002](../002-studio-v1/spec.md), and [010](../010-web-target/spec.md) for build capability boundaries.

## Context

Specs 011 and 022 already own provider connections, model facts, compatibility, current selection, turn
attribution, and Contributor consent. This feature adds an advisory writing-task view over those facts;
it does not add another provider or runtime seam.

The first slice is a local preview only. It reads a snapshot of the existing catalogue and current
connection summaries. It has no provider client, credential access, manuscript access, runtime dispatch,
selection mutation, or persistent route record. The preview is useful even if ranking and dispatch are
never approved: it can tell the author which known facts match a profile and which facts remain unknown.

## Product boundary

- **Input**: an author-selected profile and the local catalogue/connection data already exposed by the
  existing provider layer.
- **Output**: profile purpose; known capability and catalogue context/price facts; freshness; eligible,
  excluded, or unknown status with a plain-language reason; an unranked candidate list unless a public
  ranking decision is accepted later.
- **No implicit input**: no prompt, manuscript, Story Bible, chat history, tool result, credential, or
  inferred task classification.
- **No side effect**: no catalogue refresh, provider call, turn creation, library write, setting update,
  default/override mutation, or retry/fallback.
- **Use of a model**: remains the existing spec 011 model-picker and author-requested Send journey.
  Opening the picker from the preview does not preselect a model.

## Technical approach

### Shared pure profile and evaluation layer

Add a small provider-neutral module under `packages/core/src/routing/` after the task taxonomy and
profile evidence have been decided. It consumes existing `ModelInfo`, connection summaries, and
capability results rather than copying provider-specific catalogue parsing or selection rules.

- Profile definitions are versioned data with author-facing labels, purpose, and explicit requirements.
- Candidate evaluation is a deterministic pure function. It returns known matches, exclusions, and
  unknowns with reasons; it does not return an execution target or a model handle.
- Unknown required facts cannot produce a positive suitability claim. Retired, unavailable, or
  build-inaccessible models follow the existing provider rules.
- No profile is selected by reading author content. The author chooses the profile in the UI.
- Ranking is absent until the relevant public decision defines evidence and policy. A future ranking
  policy is not allowed to imply measured quality without supporting evidence.

### Cost and context display

Reuse catalogue price/context fields and their provenance. A catalogue context limit is not a guarantee
that a particular request fits. A total cost estimate is shown only when the profile's token estimate
and every required price are known; otherwise the total is “unknown” or unavailable. Estimates and
existing warnings remain informational. Accepted D-116 does not turn this preview into enforcement;
bounded-operation/qualified strict-money admission belongs to the separate ADR 0019 path.

### Shared UI and existing selection journey

Add a task-preview surface in the shared `packages/app` UI, reachable from the existing model-selection
journey without replacing it. Use the project's existing design tokens and plain status language. A
preview can link to the existing model picker, but it cannot prefill or save the suggested model. If a
later decision authorizes direct application, implement it as a separate explicit action that delegates
to spec 011's one-turn override and leaves the book default unchanged.

The renderer receives only the existing non-secret catalogue and connection summaries. No renderer
code constructs an SDK model or calls a provider. Desktop and web both respect the same registry and
the existing build-level availability rules.

### Persistence and runtime

The initial preview is transient UI state. It adds no book fields, library files, usage records, turn
metadata, IPC channel, or runtime branch. Actual turn records continue to state what actually ran under
spec 011. A future request to persist task/route decisions requires a separate public decision covering
schema, privacy, versioning, and attribution before implementation.

Automatic routing, dispatch, fallback, retries, multi-call accounting, and any independent provider
request are outside this plan's first slice. A future plan may consider them only after public decisions
cover author authorization, stop/cancel behavior, uncertain charges, partial manuscript edits, and
fallback recovery. Estimates or local reservations alone do not create a hard monetary ceiling.

## Proposed file surface

Only add or change these implementation areas after dependent decisions are resolved:

```text
packages/core/src/routing/                 task profiles and pure preview evaluation
packages/core/tests/routing/               synthetic catalogue/profile fixtures
packages/app/src/components/                shared task-preview UI
packages/app/tests/                         synthetic UI journey and unchanged-selection tests
```

The existing provider registry, catalogue parser, credential vault, transport, runtime, book schema,
usage store, and model picker remain authoritative. They should not change merely to support a
read-only preview. If a later accepted decision requires changes to those areas, its plan must identify
the smallest compatible extension and preserve specs 011 and 022.

## Decisions and gates

| Question | Current state | Blocks | Does not block |
| --- | --- | --- | --- |
| Initial task labels and profile evidence | Unresolved | Final profile data and profile-specific claims | Preview shell and generic unknown-state handling |
| Ranking and model-quality evidence | Unresolved | Scores, ordering by quality/speed, or a single “best” suggestion | Unranked compatibility and catalogue comparison |
| Local request-size/token estimate | Unresolved | Actual prompt-fit claims and total cost estimates without known input sizes | Showing catalogue context limits and prices |
| Applying/persisting a suggestion | Unresolved | Changing a selection from the preview or storing task/route metadata | Link to the unchanged existing picker; transient preview |
| D-116 cost enforcement | Accepted contract; implementation/adapter qualification pending | Strict-money claims before qualified enforcement | Informational prices and estimates with unknowns |
| Workflow dispatch and recovery | D-196 accepted for pinned selected roles; zero automatic retries/fallback | Runtime dispatch before 037 ownership/authority/admission integration | Existing author-requested send and neutral preview |

The decisions without an existing public ID must be recorded in the public decision register before the
dependent tasks start. D-116/D-196 are now specifically accepted; other questions above remain. These gates
are local to dependent work; they do not make the offline preview or its fixture tests globally blocked.

## Verification approach

- Pure core tests use synthetic profiles, catalogues, connection summaries, unknown values, and stale
  timestamps. They make no network requests and need no keys.
- Shared UI tests use an isolated fixture book and synthetic catalogue. Assert unchanged book default,
  one-turn override, conversation, usage, and chapter contents after open, profile change, cancel, and
  errors.
- A provider-call spy asserts that opening/changing/cancelling the preview produces no calls and no
  catalogue refresh. Existing explicitly initiated provider/catalogue actions remain separately tested
  under spec 011.
- A consent regression fixture asserts that preview never writes or infers the book-level Contributor
  flag and that the existing 022 refusal still applies before any future explicit send.
- No live provider, paid-service, real-manuscript, or real-credential test is part of this specification.
- Any future selection/dispatch integration needs its own decision-specific contract and verification
  plan; it is not satisfied by these offline preview tests.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A recommendation is mistaken for a quality guarantee | Keep candidates unranked until evidence and ranking policy are publicly decided; show the basis and unknowns. |
| Catalogue facts are stale or incomplete | Show freshness and unknown values; never refresh automatically or guess. |
| A model context limit is mistaken for a prompt-fit guarantee | Separate catalogue limit from actual-request fit; do not claim fit without an accepted estimator. |
| Estimated cost is mistaken for a ceiling | Label estimates/warnings informational; D-116 contract acceptance is not enforcement and unknown prices remain unknown. |
| Opening the feature unexpectedly sends author data | Preview consumes only local non-secret catalogue summaries; test with a provider-call spy and fixture library. |
| Preview and current selection drift | Preview never mutates selection; the existing picker and send path remain authoritative. |
| Contributor consent is generalized to other purposes | Preserve spec 022's per-book, default-off guard; the preview cannot set consent. |
