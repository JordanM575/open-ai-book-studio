# Expanded authoring requirements

**Author direction:** November 7, 2026. **Status:** D-194–D-200 / ADRs 0019–0021 select the contracts;
implementation, field-level writer formats and connected acceptance remain. This supplements the roadmap.

The author explicitly requested a fresh review of **all** product requirements, emphasizing
hands-free use, asynchronous multi-agent work, AutoCrit-like reviews with underlined passages, and
a short onboarding flow that can turn roughly 100 words of description into autonomous background
work toward a full book of roughly 70,000 words. The workflow should continue through revisions,
check in with the author, and ask for direction on character development.

## Required journeys and ownership

| Requirement | Intended author experience | Primary owners | Current evidence boundary |
| --- | --- | --- | --- |
| REQ-VOICE-002 | Speak direction, hear replies/check-ins, interrupt or stop, and recover from recognition errors. | 017/038; L12, W14 | D-200 selects bound sessions, segmentation, confirmation, cancellation and permission predicates. PTT/spoken replies do not establish the integrated hands-free journey. |
| REQ-REVIEW-004 | Inspect editorial critique with underlined source passages and linked explanations; navigate, filter and resolve feedback while retaining attribution. | 034/039 with 033 anchors; L08/L09, W10 | D-197–D-199 select CodeMirror plain-text underlines, complete overlaps, explicit saved feedback/application and disclosed campaigns. Implementation remains. “AutoCrit-like” is workflow inspiration, not certified parity. |
| REQ-AUTO-001 | Give a brief of about 100 words, complete small onboarding, and develop a full book toward a visible ~70,000-word target. | 037 with 030/031/033; L05, W04 | A single agent turn is insufficient. Brief, outline/characters, plan, long-run saved progress and recovery must connect. Approximate lengths are a supported scenario, not a hard input cap or quality guarantee. |
| REQ-AUTO-002 | Keep asynchronous specialists working through drafting and critique/revision cycles; get check-ins and steer character development without supervising every step. | 037 with 031/036 and history; L05/L14, W04/W10 | D-194–D-196 select a durable book-owned graph, separate host permission, candidate-only specialists, one checked publisher and versioned direction. Runtime and full-book acceptance remain. |

## Acceptance direction

- **End-to-end delivery:** a real UI journey is required. An unmounted leaf, mock report, short
  generated passage or queued task does not establish full-book delivery.
- **Brief to book:** retain the original brief and onboarding choices, show outline/character
  direction and target, run incremental chapter work, and derive progress from verified saved text.
  Draft/review/revise/finish states need testable transitions. Resume without duplicate chapter
  writes or lost author edits.
- **Multi-agent work:** define specialist roles, bounded concurrency, shared context, dependencies,
  ownership and one checked publication path. Preserve attributable outputs/errors. Several labels
  in one prompt are not evidence of asynchronous workers.
- **Human direction:** expose changes, next work and specific questions. Answers become versioned
  direction. Define which questions block dependent work and what may continue while the author is away.
- **Inline critique:** underlines refer to exact saved-source spans; selection reveals findings and
  keyboard navigation reaches them. Edits, repeated passages, overlaps and missing sources must not
  move feedback silently. Distinguish metrics from subjective interpretation. Applying suggestions
  uses checked editing and undo.
- **Hands-free:** define activation, visible/audible listening and work state, interruption,
  stop/confirm/correction, recognition failure and accessible non-voice fallback. Synthetic contracts
  precede separately recorded microphone, live-provider and device evidence.
- **Continuous background work:** define hidden-window, quit, crash/restart, provider failure,
  rate-limit and spend-limit behavior. Continuous means a durable ongoing workflow within its
  authority and availability, not execution after shutdown.

## Five concurrent development slots

This table records the **2026-11-07 five-slot dispatch wave**, when the development pool used
GPT-6 Astra/high. It is historical, not the live queue: current dispatch and ownership are in
[CONCURRENT-DELIVERY.md](CONCURRENT-DELIVERY.md). One coordinator owns integration and full-suite gates.

| Slot | 2026-11-07 deliverable | Ownership at dispatch |
| --- | --- | --- |
| 1 | Fresh history correction review | Immutable W02 `56c7b7d`; focused checks; broad gates already passed |
| 2 | Accepted planning/goal vertical integration | W08 alone owns Library/API/preload/Workspace; save/reopen/complete saved counts |
| 3 | Pure authoring graph/admission | W04 new core leaves under ADR 0019; no host writer |
| 4 | Minimal inline plain-text editor adapter | W10 leaf surface under ADR 0020; preserve existing save/undo owner |
| 5 | Pure hands-free session/permission/segmenter | W14 core leaves under ADR 0021; injected PCM/transports, no capture |

The three expanded research packets and W08 correction review are complete and preserved.
The coordinator moves freed slots into implementation and fresh independent reviews.
Existing W04 stop and W10 reader corrections remain actionable. The initial six-agent wave stays
historical. The 25-lane DAG still covers these journeys; this wave expands requirement-to-task detail.

## Existing decisions

The author approved these goals and autonomous development. ADR 0019 explicitly amends the
constitution/AGENTS authority boundary; ordinary 031 plans and foreground reviews retain their
contracts. ADR 0020 preserves volatile default while selecting recoverable explicit retention.
ADR 0021 separates microphone activation from workflow grants. Numeric bounds are engineering policy,
not measured capacity, live quality or a certified money ceiling. See [retained follow-through](RETAINED-DELIVERY.md).

All other planned features remain retained. The five-slot development cap is not a selected limit for
the application's future runtime. Existing author-data, provider-spend, microphone, film and release
restrictions apply to development/testing; 038 T022 remains unchecked.
