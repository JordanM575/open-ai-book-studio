# Plan: agent interaction and guidance

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)
**Status:** Draft — planned only; implementation has not started.

## Shape

Extend the existing author-to-agent interaction without creating a second runtime or writer. A turn's
mode, bounded guidance and any plan lifecycle state travel through the studio-owned message/thread
contract. The main-process runtime enforces the mode and controls each plan transition; the shared
composer presents author-visible state. All manuscript changes continue through the 024 tool catalog
and checked Library writer.

## Public boundaries

- **002** owns the agent's editing tools, destructive approvals, conflict handling, turn checkpoints,
  stop behavior and one-turn undo. Plan start is not an approval for any individual destructive tool.
- **011** owns the book default, one-turn model override and the model/provider/connection actually
  recorded on a turn. The new composer must reuse its control rather than add another chooser.
- **017** owns explicit per-turn background behavior. A plan cannot enable background work; any
  continuation is explicit and linked to the same plan, and a full app-process restart expires an
  unfinished plan.
- **024** owns tool definitions, schemas and safety tiers. Discuss filtering must use those existing
  definitions and must not add a second tool dialect or weaken toolkit permissions.
- **025** owns `SKILLS.md`, tool settings and plugins. Current plugins do not declare read-only
  capability, so the proposed Discuss implementation excludes them unless a public decision and
  contract change says otherwise.

## Runtime and persistence

- Extend `AgentTurnInput` with a required mode and bounded guidance values; validate them at the main
  process boundary. Keep the mode attached to the submitted/stored turn so reloads cannot infer a
  different permission level from the current composer.
- Add studio-owned plan data and events to the thread/message contract, not AI SDK UI-message types.
  Validate plan identity, bounded step text and state transitions. Store plans with their originating
  request and thread through `ThreadStore`; any explicit runtime continuation remains linked to that
  same plan. Do not add a hidden database or a second job queue.
- Apply Discuss filtering when the runtime constructs its available tools, and reject a denied tool
  at execution time as well. The renderer's mode toggle is presentation, not the security boundary.
- A plan begins in `proposed`; the runtime waits for the author to start it before exposing any
  write-capable tool. The plan state is a progress record, not authority. Existing approval requests
  remain the only way to authorize destructive actions.
- Cancel stops the runtime work linked to that plan. Do not roll back successful writes
  automatically; report partial work and rely on the existing checkpoint/undo contract. On runtime
  loss, make the stored state non-resumable and visibly expired.
- Reuse the existing book-level agent settings for tone (bounded to 500 characters) and answer
  length (Brief, Standard, Detailed). Keep optional one-turn guidance with its submitted message,
  bounded to 2,000 characters without silent truncation. Reuse 025's existing `SKILLS.md` path rather
  than creating a duplicate persistent instruction store.
- Any thread/book schema changes require corresponding `docs/FORMAT.md` documentation before
  implementation writes them. Preserve older threads by displaying their mode as unrecorded rather
  than guessing.

## Open decisions and task gates

The spec's Open decisions table is authoritative. Resolve each decision in the corresponding Phase 0
task before starting only its dependent implementation:

- Discuss default and read-only tool availability gate the Discuss tool set and composer default; the
  no-write/deny-unknown invariant is not gated.
- Pause acknowledgment and continuation semantics gate pause/resume runtime controls. Plan status,
  cancel, expiry and ordinary Edit behavior are not gated.
- Mid-run plan guidance semantics gate only live steering. Pre-send guidance and editing a proposed
  plan remain in scope.

Record outcomes in the public decision register, and add an ADR only if an outcome makes a hard-to-
reverse architectural choice. This authoring task does not edit those records.

## Likely implementation surfaces

These are future implementation touchpoints, not files changed by this specification task:

- `packages/core/src/agent.ts` — validated turn input and lifecycle events.
- `packages/core/src/agent/messages.ts` and `packages/core/src/agent/threads.ts` — stored mode,
  guidance and plan parts with bounded schemas and atomic thread persistence.
- `packages/core/src/agent/settings.ts` and the book schema — per-book tone and answer-length values.
- `apps/desktop/src/main/agent/runtime.ts` and `tool-set.ts` — permission filtering, plan transitions,
  safe cancellation and expiry; no direct writes outside registered tools.
- `packages/app/src/components/ChatPanel.tsx` and its chat-view adapter — mode, guidance, plan states,
  explicit controls and clear partial-work outcomes.
- `docs/FORMAT.md` — the public ordinary-file contract for any new thread or book fields.
- Core/runtime/component tests using temporary synthetic books and a scripted model factory; no live
  provider or real manuscript is needed.

## Verification approach

Test the author-visible contract at boundaries: mode filtering in the runtime, rejected attempts to
invoke a write in Discuss, no writes before plan start, real plan-state transitions from scripted
events, approval pauses that remain approval-gated, cancellation with partial writes, expiry after a
simulated runtime restart, and guidance scope across consecutive turns. Add component tests for
keyboard access and state announcements. Use only temporary synthetic libraries, fixture chapters
and mock provider responses. Do not use live credentials, paid services, real books or devices.
