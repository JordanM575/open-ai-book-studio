# W04 — definitive terminal Stop boundary

## Scope and authority

Implements the existing D-178 terminal-stop boundary on the W03 runtime; D-179 still requires a new
explicit turn for revised guidance. This is a prerequisite for T015–T018, not completion of the
plan lifecycle. No plan schema, persistence policy, scheduler, background grant or same-turn plan
resume is introduced. The broader thread-storage proposals remain separately owned work.

## Implemented behavior

- Stop synchronously closes the host execution gate and consumes any unclaimed pending approval.
  Its return acknowledges the request, not settlement. `stopping` is a nonterminal event.
- The runtime retains the turn and its completion promise through settling tools, an already
  claimed approval's persistence, checkpoint saves and final conversation writes. A new turn for
  that book is refused while an earlier turn is stopping/settling.
- There is no five-second settlement shortcut. Tool wrappers capture their definitive results
  independently of SDK stream delivery, deduplicate them against streamed results, and retain
  late successful writes in the final change/checkpoint facts.
- Approval consumes pending ownership before its first await. If Stop wins, approval is refused.
  If approval wins, its accepted answer remains recorded, but Stop still prevents unstarted
  execution. Failed approval persistence never dispatches its destructive action.
- Terminal publication happens once, after settlement and attempted outcome persistence.
  Conversation validation remains inside the inherited best-effort guard. A failed conversation
  or checkpoint-reference save is reported separately from actual changes and checkpoint coverage.
  A checkpoint failure does not pretend the manuscript edit was undone.
- Ordinary completion also finishes usage persistence before its terminal event. Normal Discuss,
  Edit, destructive approvals and checked one-turn undo retain their existing behavior.
- The composer keeps its controls busy and says **Stopping… Waiting for in-flight work to settle.**
  until terminal acknowledgment. It then shows stopped chapter count, actual undo availability and
  any conversation-save failure. A late approval reply cannot restore a working status.

## Focused verification

All fixtures are synthetic temporary libraries and scripted `MockLanguageModelV4` responses.
No provider/keychain/device/real-library access is required.

- `pause-boundary-premises.test.ts`: a checked write gated for 5.25 seconds, retained active/background
  ownership, refusal of another turn while stopping, late successful receipt exactly once, saved
  checkpoint and successful undo; both Stop/Approve call orders with gated persistence; approval
  failure; already-dispatched destructive write; synchronous dispatch refusal; late write rejection;
  slow/failing checkpoint, conversation and checkpoint-reference persistence; stop during approval
  publication and ordinary finalization; and a deliberately never-settling adapter.
- `agent-runtime.test.ts`: existing success/error/approval/denial/conflict/undo behavior, plus the
  inherited long-error, long-retry-delay and invalid-conversation terminal-event guards. Stop tests
  now await terminal acknowledgment rather than relying on the stop call's return.
- `chat-composer.test.tsx`: busy controls after Stop returns, terminal change/undo/save-failure copy,
  both approval/stop orderings, and late approval reply handling alongside mode/guidance regressions.
- `turn-checkpoint.test.ts`, `checkpoints.test.ts`, `agent-modes.test.ts`,
  `inflight-guidance-premises.test.ts`, `agent-threads.test.ts`, `tool-set.test.ts`,
  `tool-bridge.test.ts`, and core `agent-interaction-contract.test.ts`: focused regression coverage.

Desktop node/web typechecks and changed-file lint are the local gates. Whole-application verify,
coverage, build, e2e, independent review and exact-candidate UI acceptance remain with integration.

Local results on November 7, 2026: **191 passed, 0 failed, 1,097 assertions** across the eleven
files above. The guidance test's fixture cleanup was then corrected to await terminal Stop; its
focused rerun passed **2 tests / 6 assertions** without the earlier teardown warning. Both desktop
TypeScript projects pass. Lint of the seven changed TypeScript files exits successfully with
46 existing non-null-assertion warnings and no errors; no lint rule or baseline was changed.

## Limits and parent integration

A never-settling adapter remains **Stopping** indefinitely with outcome unresolved and no new turn
admitted for that book. No timeout proves success, no forced abort rolls back an atomic write, and
process loss cannot recover a receipt that was never persisted. Restart/plan expiry and reattachment
still need the plan lifecycle work. This change does not make current ThreadStore writes checked,
lossless, transactional or concurrency-safe; its shared-writer migration is a separate prerequisite.
External writer races, detached plugin work outside its returned promise, and ambiguous adapter
publication cannot acquire stronger guarantees from runtime promise tracking.

The additive `stopping` event and terminal `persistenceError` field use the existing event transport.
The coordinator must check other event consumers and lifecycle callers on the integrated candidate:
Stop's return cannot authorize library disposal/deletion or claim Paused. The current active lookup
and completion promise remain alive until the terminal boundary; no new global route is added.

### Interaction runbook addition

1. Start an Edit turn with a synthetic checked write held longer than five seconds. Press Stop.
   Confirm Stopping remains visible, Send stays unavailable, and no Paused/Stopped claim appears.
2. Release the write. Confirm one terminal outcome, one tool result, the actual changed chapter and
   a working Undo only when its checkpoint is complete.
3. Repeat with a destructive approval, each Stop/Allow order, delayed approval persistence and a
   failed save. Confirm no unstarted destructive action runs after Stop and no late reply restores
   Working. Surface a conversation-save failure separately from a successful manuscript change.
4. Repeat with an adapter that never resolves. Confirm it remains unresolved rather than displaying
   a fabricated zero-change success. No automatic continuation or background permission is offered.
