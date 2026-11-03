# Pause acknowledgment and continuation semantics (031 T002)

Status: research, not accepted. This document defines the completed-pause
boundary, same-turn versus new-turn continuation, and non-background window
close from the implemented stop/approve/turn machinery, and proposes D-178.
It authorizes no runtime, composer, or schema change; T005+ still wait on
acceptance.

## What must hold

- A pause request stops dispatching later tools; it does not undo completed
  work (spec invariant).
- The interface must not say "Paused" until the runtime confirms that no tool
  can still start.
- Start/Resume are always author actions and cannot answer or bypass an
  approval.
- A plan cannot grant background permission (017 owns per-turn background).

## Verified facts the decision rests on

- `stop(turnId)` is synchronous and terminal: it expires a waiting approval in
  the thread store, publishes `stopped`, aborts the turn controller, and
  removes the turn from the active set (`AgentRuntime.stop`). There is no
  resume entry — starting again always mints a new turn id.
- `approve(turnId, approvalId, approved)` requires the turn to be active and
  the approval id to match; anything else throws `not-found`. A stopped
  turn's approval is unanswerable — not even by a newer turn (pinned in
  `apps/desktop/tests/pause-boundary-premises.test.ts`).
- Stopping mid-write does not tear the file: the gated in-flight write
  commits atomically through the checked writer, the stopped event carries the
  change count with undo available, and the stopped tail message is persisted
  before the event fires (pinned in the same file). The UI rule follows: the
  terminal `stopped` event — not the return of the stop call — is the proof
  that dispatch halted and the in-flight tool reached its definitive outcome.
- `start()` always creates a new turn; a thread id continues the conversation
  but never resurrects a stopped turn (pinned: distinct turn ids, finished
  turns stop to a null no-op, the new thread reads back).
- Completed and stopped turns leave their thread behind: partial tool calls,
  expired approvals, and the stopped tail stay recorded; nothing is rolled
  back by stopping (existing `agent-runtime.test.ts` pins the expired
  approval part and the stopped event).
- Background is an explicit per-turn opt-in (`AgentTurnInput.background`);
  closing the window does not stop a background turn, and a quit app or the
  web build promises no background execution (017 FR-012/FR-015/FR-017,
  `AgentTurnInput` contract).
- During this research, stopping a turn and immediately starting the next one
  raced the settling tail against thread teardown in the test harness only
  (warn-and-drop console lines, assertions unaffected). The product never
  tears a library down mid-turn, but the lesson is real: a continuation turn
  must sequence on the terminal event, never on the stop call's return.

## Alternatives considered

- **A. Pause completes on the terminal event; continuation is a new explicit
  turn; non-background close stops the turn (recommended).** "Paused" displays
  only after the runtime emits `stopped` for the turn: by then no tool can
  start and the in-flight tool has its definitive outcome recorded. Resume
  starts a new turn linked to the stored plan (there is no live-turn
  continuation to resurrect). Closing the window with a non-background turn
  running stops it like an author stop; the stored plan is marked expired on
  process restart and never resumes silently. Rejected variants below.
- **B. Pause completes when the stop call returns.** Rejected: the call
  returns before the in-flight tool settles and before the tail persists. An
  immediate continuation turn would race the settling write on the same
  thread file. The event is the boundary, not the return.
- **C. Resume continues the same live turn.** Rejected: no such machinery
  exists — stop removes the turn and aborts its controller — and resurrecting
  an aborted SDK loop would re-enter an unknown tool state. A new turn from
  the stored plan is explicit, auditable, and already the shape of `start()`.
- **D. Pause answers or inherits a waiting approval on resume.** Rejected:
  approvals are strictly per (turn, approval id). A resumed turn re-raises
  any still-needed approval through the normal path; nothing is pre-approved.
- **E. Window close pauses non-background turns for later resume.** Rejected:
  close/quit behavior is frozen by standing rules, and a parked live turn
  across process death is a second lifecycle to own. Close stops the turn;
  restart expires the plan visibly. Background turns keep their 017 behavior
  (close does not stop them; quit still ends them).

## Recommendation detail

- The composer shows "Paused" for a turn only after its `stopped` event
  arrives; until then it shows "Stopping…". The event carries the change
  count and whether undo is available, which the composer reports.
- Pause never undoes completed writes, never answers approvals, and never
  grants background. A waiting approval at pause time expires in the thread
  like a stop (existing behavior), and resume re-raises it if still needed.
- Start/Resume after a pause creates a new turn from the stored plan,
  linked by plan id (T005), in the same thread. The new turn revalidates
  everything it touches; the paused turn's checkpoint and undo remain
  available under the existing one-turn rules.
- A non-background turn running at window close is stopped; on process
  restart any unfinished plan reads as expired, never resumable. A plan id
  never flips a turn to background.
- The renderer sequences continuation on the terminal event. No second
  writer, no second approval path, and no change to close/quit behavior.

## What stays with later tasks

Plan storage and identity (T005), pause/resume controls and states (T006),
mode/guidance persistence (T004), and in-flight guidance (T003).
