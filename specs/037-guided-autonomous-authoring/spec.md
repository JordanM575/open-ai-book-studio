# Guided and autonomous authoring

**Status:** In progress — foreground core and full-book contracts; runtime journey not implemented
**Number:** 037
**Depends on:** [002](../002-studio-v1/spec.md) agent and library contracts; [011](../011-model-access/spec.md) provider and model selection; [024](../024-agent-tool-parity/spec.md) tool tiers; [025](../025-agent-capabilities/spec.md) per-book tool controls and plugins; [012](../012-automated-verification/spec.md) verification approach.

U-037-01/02 were accepted November 7 as D-193 / [ADR 0018](../../docs/adr/0018-scoped-review-contracts.md).
Pure source-envelope/citation work can proceed; runtime/UI and the prerequisite shared thread-safety
implementation remain open. D-194–D-196 / [ADR 0019](../../docs/adr/0019-bounded-autonomous-authoring.md)
now resolve the separate full-book authority, ownership, recovery, admission and evidence contracts.

**Expanded author direction, November 7:** REQ-AUTO-001/002 explicitly retain short-brief onboarding
toward a full ~70,000-word book, asynchronous multi-agent background work, revision cycles and human
check-ins for character direction. See [the requirement expansion](../../docs/EXPANDED-AUTHORING-REQUIREMENTS.md).
The foreground slice below is not the completion boundary. The accepted full-book requirements and
implementation tasks below preserve the entire journey.

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
- Current ordinary D-126 behavior remains per-turn opt-in. Its new 037 exception requires a separate
  bounded workflow grant and implementation; an ordinary background checkbox never supplies one.
- The public contracts do not define the guided, read-only review flow below. It is separate from
  spec 034's deterministic structured report; it does not replace that report with a model-generated
  score, metrics sheet or export.

## Proposed behavior

### Phase 1 — foreground guidance

The author selects a passage or chapter, chooses any additional source material to include, and starts
a concise conversational review in the foreground. The answer gives useful observations tied to
human-readable source citations. It cannot edit, stage or publish manuscript changes.

A model review sends only a captured immutable envelope of explicitly selected content to the
configured provider. Its built-in read tools project that envelope and cannot expand it. Before the request starts, the
interface identifies the provider and model, shows the content scope, and says plainly that this
content will be sent there. The author starts the request with an explicit provider-named action; a
cancel before that action sends nothing. No unselected content may enter the executor, prompt, tool
result or request. Local identity/permission resolution may inspect container metadata and chapter
candidates under existing Library rules; this is not a promise of zero other local filesystem reads.

### Phase 2 onward — bounded full-book workflows

ADR 0019 selects the durable host-coordinated graph, ordinary candidate files, narrowly authorized
automatic publication, independent editorial attempts and recurring human direction. Defaults and
failure contracts in that ADR are normative. The implementation sequence is T017–T042; only its
connected final journey establishes REQ-AUTO-001/002. Field-level formats and independently reviewed
storage/runtime boundaries precede enabling their writers/dispatch. Pure reducers can proceed now.

## User stories

1. **Ask for focused guidance.** I select a passage or chapter, see exactly what will be reviewed and
   which configured provider will receive it, then ask for concise feedback without enabling edits.
2. **Trust the citations.** I can open a cited passage and see which source revision the review used.
   If the source changes while the review is running, the result is visibly stale rather than presented
   as current.
3. **Stop safely.** I can stop a foreground review. No manuscript file changes; the request is marked
   incomplete, and I can retry the retained prompt and scope.
4. **Develop a book.** Start from a short brief, choose a visible target/agreement, approve outline/cast
   direction, and inspect saved chapters, independent reviews and revisions as work advances.
5. **Steer characters.** Answer an attributable character question; dependent work pauses while
   independent authorized work may continue. Correct direction without losing old drafts or edits.
6. **Resume truthfully.** Reopen the project with retained work and unresolved outcomes; continue safe
   remaining tasks without repeating uncertain requests or publications.

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
  Before new review parts are persisted, the shared conversation store MUST have a reviewed checked-write,
  recoverable-deletion and versioned-reader contract. D-193 does not approve the current unchecked
  overwrite/direct-removal behavior as evidence of that contract.
- **FR-009** Stopping a review MUST stop further tool/model work on a best-effort basis, preserve the
  prompt and selected scope for retry, and mark the result incomplete. The interface MUST explain
  that content already sent to a provider cannot be recalled. A provider, tool or source-read failure
  MUST leave manuscript files unchanged, release the busy state, explain what failed and offer a
  safe next action. A failed or refused request MUST NOT silently switch providers or models.
- **FR-010** A missing connection, unsupported model, provider consent requirement, disabled read tool,
  unreadable source or stale source MUST block the affected call and explain the next safe action. The
  app MUST NOT silently widen the source scope or switch tools, providers or models. Existing provider
  consent and capability checks MUST remain in force; review MUST NOT bypass them.

### Full-book workflow requirements

- **FR-011** Implement autonomous work only under D-194–D-196/ADR 0019; shared checked storage,
  truthful settlement and real host ownership MUST precede enabled execution/publication.
- **FR-012** The accompanying constitution/AGENTS amendment limits network authority to explicit
  actions or active bounded revocable sessions/workflows. Ordinary D-126 opt-in MUST NOT mint a grant.
- **FR-013** Permission, source scope, destination, limits, candidate/publication ownership and
  recovery MUST remain independently inspectable; worker text or copied files cannot extend them.
- **FR-014** Optional small onboarding MUST retain the exact brief and narrative choices, expose a
  configurable default 70,000 saved-word target using 033, and offer local setup with zero sends.
- **FR-015** Distinct asynchronous specialist attempts MUST have immutable scoped context, separate
  output/usage lineage and declared dependencies. A multi-role prompt is not asynchronous execution.
- **FR-016** Planning, incremental scenes/chapters, independent developmental and line/continuity
  review, bounded revision/recheck and whole-book synthesis MUST form the actual execution graph.
- **FR-017** Only the Library publisher may adopt exact candidates under current grant, direction,
  review and editor/base checks. Automatic revision is restricted to opted-in run-created unchanged
  clean targets; existing/manual/external text requires a new exact action authorization.
- **FR-018** Durable questions MUST name character/source/run identity, consequences and affected
  work. Confirmed answers become versioned direction; silence chooses nothing. Old-epoch outputs
  remain historical and cannot publish; provably independent work may continue.
- **FR-019** Pause/cancel MUST close gates before awaits and report terminal state only after actual
  settlement. Quota/failure/uncertain charging parks work with no automatic retry or fallback.
- **FR-020** Window/renderer lifetime MUST NOT own jobs. Quit/sleep stops execution; restart locally
  reconciles intents/receipts and requires Continue unless a valid same-host resume grant permits
  safe fresh work. No uncertain provider call/write is automatically replayed.
- **FR-021** Artifacts, safety, directions and effect/accounting receipts MUST be ordinary retained
  files with checked mutations, issue-bearing reads, archive/trash preservation and no auto-pruning.
  Host permission MUST stay separate and non-exported. Cross-file changes are not a transaction.
- **FR-022** Admission MUST enforce finite call/output/time/concurrency/revision limits and distinguish
  known subtotal/unknown charges. Strict-money mode requires qualified enforcement, never an estimate.
- **FR-023** Progress MUST use complete verified saved text; candidates/tokens are separately labelled.
  Draft complete, editorial pass complete, needs direction and final author review are distinct states.
- **FR-024** Hands-free check-ins MUST consume the same typed identities/intents under ADR 0021;
  starting a book workflow MUST NOT open a microphone or authorize unrequested speech.
- **FR-025** Full-book protocol, synthetic scale, literary quality, usability, actual host/device and
  release evidence MUST be recorded separately. A preseeded novel or short demo cannot close the
  integrated brief-to-book journey.

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

## Full-book acceptance

Use actual small onboarding, mocked independent transports and real checked storage to develop a
28-chapter reference around 70k saved words (63k–77k), including independent concurrent reviews,
revisions and character answers, manual edits, fresh-process restart and uncertain-dispatch recovery.
No direct fixture seeding after Start substitutes for the pipeline. Require exact request/output
provenance, no duplicate chapter publication, complete declared coverage and a resolved ending.
Short completion needs an explicit author decision. Live quality and acoustic/device checks require
their separately authorized evidence; no current approval for paid runs or microphone use follows.

## Non-goals

- The deterministic structured report defined separately by spec 034.
- Editing, staging or publishing from the Phase 1 foreground review itself.
- Plugin tools, toolkit/MCP calls, remote agents or a new provider route in Phase 1.
- Unbounded permission, daemon/after-quit execution, remote delivery, automatic provider fallback or
  blanket write/destructive authority. Ordinary turns retain their existing policy.

## Open decisions

The table retains local IDs. D-193 resolves U-037-01/02; D-194–D-196 resolve U-037-03–07.
No decision alone proves runtime implementation.

| ID | Question and evidence needed | Blocks |
| --- | --- | --- |
| U-037-01 | Accepted D-193 / ADR 0018: one immutable, exactly disclosed source envelope; captured-source facade only, explicit start/rerun, no implicit history/SKILLS. Selected request text is retained in the existing conversation after its shared safety prerequisite. A user study is not claimed. | Policy resolved; T004–T005/T010 implementation and conversation-safety integration remain |
| U-037-02 | Accepted D-193 / ADR 0018: exact identity/version/raw hash plus in-scope UTF-16 span and literal quote; derived author-facing line labels, strict stale/clean-editor checks before selection. | Policy resolved; T006–T007/T010 implementation remains |
| U-037-03 | Accepted D-194: explicit bounded host-local grant, selected sources/roles/destinations, revocation and candidate-only workers; constitution/AGENTS amended. | T019–T025 implementation/integration |
| U-037-04 | Accepted D-195: ordinary immutable candidates, checked state/effects, safety and narrowly opted-in run-created target adoption; no blind replay. | T018/T023/T029 formats and publisher evidence |
| U-037-05 | Accepted D-195: deterministic pinned host, branch blocking/inbox, truthful settlement, no after-quit work, default explicit restart Continue. | T020/T025/T032–T035 |
| U-037-06 | Accepted D-196: separately scoped protocol, actual synthetic full-length, live quality, usability, host/device and release gates. | T039–T042; quality rubric before evaluation |
| U-037-07 | Accepted D-196/D-116: finite request/time/output/revision admission, bounded-operation versus qualified strict-money mode. D-129 remote delivery remains deferred. | T022/T024/T025; no live strict-cap adapter certified |
