# Expanded authoring requirements

**Author direction:** November 7, 2026. **Status:** retained product scope; detailed contracts and
implementation acceptance remain to be completed. This supplements the existing roadmap.

The author explicitly requested a fresh review of **all** product requirements, emphasizing
hands-free use, asynchronous multi-agent work, AutoCrit-like reviews with underlined passages, and
a short onboarding flow that can turn roughly 100 words of description into autonomous background
work toward a full book of roughly 70,000 words. The workflow should continue through revisions,
check in with the author, and ask for direction on character development.

## Required journeys and ownership

| Requirement | Intended author experience | Primary owners | Current evidence boundary |
| --- | --- | --- | --- |
| REQ-VOICE-002 | Speak direction, hear replies/check-ins, interrupt or stop, and recover from recognition errors. | 017/038; L12, W14 | Push-to-talk and spoken replies exist; they do not establish continuous conversation, interruption or hands-free workflow control. Activation/listening needs a recorded decision. |
| REQ-REVIEW-004 | Inspect editorial critique with underlined source passages and linked explanations; navigate, filter and resolve feedback while retaining attribution. | 034/039 with 033 anchors; L08/L09, W10 | Deterministic review and isolated reader leaves cover parts. Persistent inline critique needs design and implementation. “AutoCrit-like” describes the workflow, not certified feature/score parity. |
| REQ-AUTO-001 | Give a brief of about 100 words, complete small onboarding, and develop a full book toward a visible ~70,000-word target. | 037 with 030/031/033; L05, W04 | A single agent turn is insufficient. Brief, outline/characters, plan, long-run saved progress and recovery must connect. Approximate lengths are a supported scenario, not a hard input cap or quality guarantee. |
| REQ-AUTO-002 | Keep asynchronous specialists working through drafting and critique/revision cycles; get check-ins and steer character development without supervising every step. | 037 with 031/036 and history; L05/L14, W04/W10 | One-turn background opt-in is insufficient. Worker/publication ownership, authority lifetime, budgets, questions, cancellation and restart need explicit contracts. |

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

The development pool is now **five concurrent agents**, all using the requested Astra Ultrafast/high
configuration. One coordinator owns integration and full-suite gates.

| Slot | Immediate deliverable | Ownership |
| --- | --- | --- |
| 1 | Reconcile every retained product requirement, including hands-free gaps and priority/lane expansion | Read-only audit and proposed traceability/decision changes |
| 2 | Brief-to-full-book asynchronous architecture, onboarding and human check-in decision packet | Read-only autonomy design and recommended state/storage/authority contracts |
| 3 | AutoCrit-style workflows and exact-underlining interaction/implementation packet | Read-only critique design and current product research |
| 4 | Review delivered history restore/undo/recovery core and history UI | Immutable W02 candidates; focused checks |
| 5 | Review corrected planning/goal core and editor | Immutable W08 candidate; focused/native checks |

The coordinator accepts specific evidenced recommendations and moves freed slots into implementation.
Existing W04 stop and W10 reader corrections remain actionable. The initial six-agent wave stays
historical. The 25-lane DAG still covers these journeys; this wave expands requirement-to-task detail.

## Existing decisions

The author approved these feature goals and autonomous development toward them. Existing 037
foreground-review contracts, 039 volatile-review contracts, D-126 one-turn opt-in and the constitution
are not a finished long-running authority model. The autonomy packet must propose precise amendments
and recoverable implementation; the coordinator can accept them under existing delegated authority.

All other planned features remain retained. The five-slot development cap is not a selected limit for
the application's future runtime. Existing author-data, provider-spend, microphone, film and release
restrictions apply to development/testing; 038 T022 remains unchecked.
