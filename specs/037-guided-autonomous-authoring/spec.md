# Guided and autonomous authoring

**Status:** Draft (Planned; not started)
**Number:** 037
**Depends on:** [002](../002-studio-v1/spec.md) agent and library contracts; [011](../011-model-access/spec.md) provider and model selection; [024](../024-agent-tool-parity/spec.md) tool tiers; [025](../025-agent-capabilities/spec.md) per-book tool controls and plugins; [012](../012-automated-verification/spec.md) verification approach.

## Why

An author should be able to ask for brief, grounded guidance without giving an agent permission to
change a manuscript. That safe, foreground interaction is a useful first step toward workflows that
may eventually do more, but autonomous work needs its own authority, ownership, recovery and proof
contracts. A request to review prose must not silently become permission to edit it or keep working
later.

## Current public behavior

- Spec 002 defines an author-started writing-agent turn with built-in read and write tools. Tool edits
  can apply during the turn; destructive actions require approval, and a turn can be undone.
- Specs 024 and 025 define the shared tool catalog, read/write/destructive tiers, per-book tool
  controls, and author-selected TypeScript plugins. Plugins run in the app process and may access the
  open book through the library surface.
- Public decision D-126 permits a background turn only when the author opts in for that turn. It does
  not grant standing authorization. The existing quit and notification behavior is unchanged by this
  spec.
- The public contracts do not define the guided, read-only review flow below. It is separate from
  spec 034's deterministic structured report; it does not replace that report with a model-generated
  score, metrics sheet or export.

## Proposed behavior

### Phase 1 — foreground guidance

The author selects a passage or chapter, chooses any additional source material to include, and starts
a concise conversational review in the foreground. The answer gives useful observations tied to
human-readable source citations. It cannot edit, stage or publish manuscript changes.

A model review sends the selected content, plus any additional author-selected content that the
review's built-in read tools retrieve, to the configured provider. Before the request starts, the
interface identifies the provider and model, shows the content scope, and says plainly that this
content will be sent there. The author starts the request with an explicit provider-named action; a
cancel before that action sends nothing. No unselected book content may be fetched or sent to expand
the scope silently.

### Later direction — verified autonomous workflows

The eventual goal is to let an author request a bounded workflow and inspect evidence about its
results. This is a direction, not an implementation contract: this draft does not authorize candidate
creation, background workers, standing permissions, schedules, automatic publication, notifications,
restart or recovery behavior, budgets, or remote delivery. Each remains gated by the public decisions
and contracts listed below. A gate blocks only the dependent future work, not Phase 1.

## User stories

1. **Ask for focused guidance.** I select a passage or chapter, see exactly what will be reviewed and
   which configured provider will receive it, then ask for concise feedback without enabling edits.
2. **Trust the citations.** I can open a cited passage and see which source revision the review used.
   If the source changes while the review is running, the result is visibly stale rather than presented
   as current.
3. **Stop safely.** I can stop a foreground review. No manuscript file changes; the request is marked
   incomplete, and I can retry the retained prompt and scope.
4. **Review future work deliberately.** Only after the open authority, verification, ownership and
   recovery questions are resolved may a later spec define autonomous workflows and their evidence.

## Requirements

### Foreground read-only review

- **FR-001** The author MUST explicitly start each review from a visible foreground control. Phase 1
  MUST NOT start a review on a schedule, continue as a background worker, or change window-close,
  application-quit or notification behavior.
- **FR-002** Before a request starts, the interface MUST name the configured provider and model, list
  the selected passage/chapter and any additional author-selected sources in scope, and disclose that
  their content will be sent to that provider. A review action MUST identify its destination. The
  request MUST NOT include unselected manuscript or Story Bible content.
- **FR-003** A review MUST use only built-in tools whose catalog tier is `read` and that are enabled
  for the book. Write and destructive tools MUST be absent from the review turn and refused by the
  execution boundary if requested. Review MUST NOT load or call plugin tools, even when plugins are
  enabled elsewhere.
- **FR-004** Review source text, Story Bible text and tool results MUST remain untrusted book data, as
  specified by 002 FR-023a. Instructions embedded in that data MUST NOT grant permissions, widen the
  selected scope or change the tool allowlist.
- **FR-005** The response MUST be concise conversational guidance, not a deterministic report, score,
  candidate, patch or publication. It MUST distinguish a source-backed observation from general
  advice and MUST cite each source-backed observation.
- **FR-006** A citation MUST identify the book and chapter in author-facing terms, a resolvable
  passage/line location, and the source revision used. It MUST open the cited source. Internal IDs,
  revision tokens and raw tool payloads MUST NOT be shown as the citation.
- **FR-007** The review MUST capture the revision of each source it reads. Before presenting a result
  as current, the app MUST compare those revisions with the current sources. A changed or missing
  source MUST be marked stale or unavailable; the app MUST NOT silently refresh, claim the result is
  current, or fabricate a citation. The author may explicitly rerun the review against current text.
- **FR-008** A review request, its read-tool results, citations and answer MUST follow the existing
  conversation's storage and deletion behavior. This feature MUST NOT create a separate report file,
  candidate store or hidden history.
- **FR-009** Stopping a review MUST stop further tool/model work on a best-effort basis, preserve the
  prompt and selected scope for retry, and mark the result incomplete. The interface MUST explain
  that content already sent to a provider cannot be recalled. A provider, tool or source-read failure
  MUST leave manuscript files unchanged, release the busy state, explain what failed and offer a
  safe next action. A failed or refused request MUST NOT silently switch providers or models.
- **FR-010** A missing connection, unsupported model, provider consent requirement, disabled read tool,
  unreadable source or stale source MUST block the affected call and explain the next safe action. The
  app MUST NOT silently widen the source scope or switch tools, providers or models. Existing provider
  consent and capability checks MUST remain in force; review MUST NOT bypass them.

### Autonomy gates

- **FR-011** No autonomous implementation is authorized by this draft. Before any such implementation,
  the dependent public decisions MUST be accepted and recorded, the verification criteria MUST be
  agreed, and a reviewed ownership/recovery contract MUST define who owns work and its artifacts,
  cancellation, failure, conflict and recovery behavior.
- **FR-012** If a future autonomous capability changes a constitutional principle or an AGENTS.md
  non-negotiable, its required ADR and reviewed amendment to both documents MUST be accepted before
  implementation. D-126 authorizes one explicitly opted-in background turn only; it MUST NOT be
  treated as authority for standing permissions, schedules or unattended workflows.
- **FR-013** Any later spec MUST state its allowed tools, data scope, permission lifetime and
  revocation path; candidate ownership and publication rules; lifecycle and recovery; and measurable
  verification evidence. Unresolved decisions block only the tasks that depend on them.

## Acceptance scenarios for Phase 1

1. **Disclosed request.** With a synthetic book and mocked provider transport, the author selects one
   passage, sees the provider/model and exact source scope, and starts a review. The request contains
   only that selected content and any explicitly included sources.
2. **No send on cancel.** Before starting the request, the author cancels. A request spy observes no
   provider call, and the prompt and scope remain available.
3. **Read-only boundary.** A synthetic review may call enabled built-in read tools. A requested write,
   destructive action, disabled tool or plugin call is unavailable and refused; the fixture files are
   byte-identical afterwards.
4. **Citations.** Each source-backed observation links to its source passage and captured revision.
   A citation with no resolvable source is not presented as verified evidence.
5. **Stale source.** A fixture source changes during a review. The answer is marked stale and offers
   an explicit rerun; it is not represented as a review of the new text.
6. **Failure and stop.** A simulated provider refusal, read error or author stop leaves fixture files
   unchanged, preserves the request, identifies the incomplete outcome and leaves the interface ready
   for another action.
7. **No autonomy by implication.** Enabling a review or a plugin, or having previously opted into one
   D-126 background turn, does not enable a later unattended run or change close/quit/notification
   behavior.

All verification uses synthetic isolated fixtures and mocked provider/tool boundaries. Live-provider
requests and real manuscripts are outside this spec's acceptance work.

## Non-goals

- The deterministic structured report defined separately by spec 034.
- Editing, applying, staging or publishing review suggestions.
- Plugin tools, toolkit/MCP calls, remote agents or a new provider route in Phase 1.
- Standing permissions, unattended/background workers, schedules, notifications, automatic
  publication, restart/recovery, budgets or remote delivery until their gates are resolved.
- Changes to current D-126 one-turn opt-in, notification, window-close or application-quit behavior.

## Open decisions

These are unresolved public questions, not accepted decisions. The task IDs below are their only
blockers; none blocks unrelated Phase 1 work or the whole spec.

| ID | Question and evidence needed | Blocks |
| --- | --- | --- |
| U-037-01 | Which selected content and tool-returned source payload are sent and retained in the existing thread, and how is that exact scope disclosed before sending? Test the scope/disclosure with authors and record the provider-boundary contract. | T004–T005 and the dependent synthetic checks in T010 only |
| U-037-02 | Which author-visible location and revision label make a citation resolvable across supported builds? Confirm the version comparison contract against the shared library. | T006–T007 and the dependent citation/stale checks in T010 only |
| U-037-03 | What authority, scope, lifetime, revocation and tool/plugin policy could any autonomous workflow have? Resolve through public decisions and a reviewed constitution/AGENTS amendment if required. | T016 and dependent autonomous implementation only |
| U-037-04 | Who owns autonomous work and candidates, how are they stored/versioned/recovered, and what author review, conflict and publication steps apply? Include whether any automatic publication is permitted. | T016 and dependent candidate/publication implementation only |
| U-037-05 | Who owns background execution, cancellation, failures, restart/recovery, close/quit, notifications and schedules? D-126 answers only the single explicitly opted-in turn. | T016 and dependent background/scheduled implementation only |
| U-037-06 | What evidence qualifies as “verified” autonomous work, including synthetic/adversarial cases, measurable thresholds and regression policy? | T016 and dependent verified-workflow implementation only |
| U-037-07 | What limits govern multi-step spend, duration and remote delivery? D-116 is Proposed, and D-129 is Deferred; neither authorizes autonomous budgets or remote delivery. | T016 and dependent budgeted/remote implementation only |
