# In-flight guidance semantics (031 T003)

Status: research, not accepted. This document decides whether new guidance can
reach a running or paused plan and whether that revises the plan or requires a
new turn, and proposes D-179. It authorizes no runtime, composer, or schema
change; plan storage (T005) and controls (T006–T008) still wait on acceptance.

## What must hold

- No live steering exists until this is decided; the author can cancel and
  send a new turn (spec invariant).
- Pause/continuation follows D-178: pause completes on the terminal `stopped`
  event, continuation is always a new explicit turn, approvals stay strictly
  per turn.
- Guidance edits to a proposed (not started) plan are not blocked by this
  task; neither are pre-send controls.

## Verified facts the decision rests on

- A turn's submitted prompt is fixed in its thread while it runs: starting a
  turn that parks on approval stores exactly the user message plus the parked
  approval request, and no runtime entry mutates either (pinned in
  `apps/desktop/tests/inflight-guidance-premises.test.ts`).
- Revised guidance travels by stopping and starting a new turn in the same
  thread: both prompts and both answers persist in order under distinct turn
  ids (pinned in the same file). The new turn revalidates everything it
  touches; the stopped turn's checkpoint and undo remain under the existing
  one-turn rules.
- The runtime offers no message/guidance entry for a live turn — only
  start/stop/approve/undo (`AgentRuntime`, `StudioApi` agent section). There
  is no channel to steer a running SDK loop, and D-178 deliberately adds none:
  resurrecting or redirecting an aborted loop would re-enter unknown tool
  state.
- The guidance channels that exist all act between turns, never inside one:
  the start prompt, retried prompts (`prepareThread` reuses the same user
  message rather than duplicating it), the book's `SKILLS.md` (read when the
  turn's tools are built), and per-book settings (today `disabledTools` and
  `skillsEnabled`; tone/answer-length arrive with T004).
- Anything added mid-run would enter the model context as unvalidated text.
  The prompt guard treats book content as data, never instructions; a
  mid-loop injection path would need the same trust boundary design as
  `SKILLS.md`, which is author-owned file data read at turn start — not a
  live wire into a running loop.

## Alternatives considered

- **A. No in-flight injection; guidance travels by new turns (recommended).**
  A running or paused plan cannot receive new guidance. The author edits a
  proposed plan before Start, or cancels/stops and sends a new turn with
  revised guidance in the same thread. New turns re-raise approvals as
  needed; nothing is inherited, nothing is pre-approved. This is already the
  working fallback and needs no new machinery.
- **B. Revise the same plan mid-run.** Rejected: a paused turn is terminally
  stopped (D-178) — there is no live plan object to revise — and a running
  turn's loop has no steer channel. "Revision" would mean mutating stored
  plan text the runtime is concurrently executing: a race between author
  intent and dispatch with no acknowledgment boundary.
- **C. Queue guidance for the continuation turn.** Rejected as a separate
  mechanism: it is alternative A with extra state. The continuation turn's
  own prompt carries the guidance; a standing queue adds storage, ordering,
  and staleness questions (does queued guidance survive restart? expire?)
  for no author-visible gain.
- **D. Live-steer the running loop.** Rejected: no SDK channel, breaks the
  D-178 event boundary (guidance landing between tool dispatch and the
  terminal event is unacknowledgeable), and bypasses per-turn approval
  isolation. If a future model protocol offers structured steering, that is
  a new spec, not this decision.
- **E. Treat guidance as approval answers.** Rejected: approvals answer a
  named tool call with allow/deny, nothing else. Smuggling guidance through
  approval responses corrupts the audit trail (the stored part records an
  approval decision, not author instructions).

## Recommendation detail

- The composer offers no guidance control for a running or paused plan. The
  available actions stay exactly the existing ones: wait, stop/cancel, and —
  after the terminal event — start a new turn.
- Guidance editing stays where it already works: the pre-send composer, the
  proposed-plan review (unedited start waits for Start), `SKILLS.md` between
  turns, and each new turn's prompt.
- A stopped plan's stored text remains the record of what was attempted; a
  new turn references it by plan id once T005 storage exists, but never
  mutates it. Expired plans stay expired (D-178).
- If in-flight guidance is ever revisited, it requires a steer-capable model
  protocol, a trust-boundary design for injected text, and an acknowledgment
  event stronger than `stopped` — a new decision, not an extension of this
  one.

## What stays with later tasks

Plan storage and identity (T005), pause/resume controls (T006), mode and
per-turn guidance persistence (T004), and the composer surfaces (T007/T008).
Pre-send guidance and proposed-plan editing proceed now.
