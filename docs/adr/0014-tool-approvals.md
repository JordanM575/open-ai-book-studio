# 0014 Tool approvals for destructive actions

**Status:** Accepted
**Related:** [0007](0007-agent-runtime.md), [0013](0013-agent-message-format.md), spec 002 FR-024

## Context

The writing agent can edit the manuscript through tools, but one class of change must not happen
without the author's answer: destructive actions. Spec 002 FR-024 names deleting a chapter,
overwriting a chapter, removing a memory and replacing a library. ADR 0007 already says the
destructive tools pause for the renderer's decision and use the SDK's tool-approval facilities where
they exist.

AI SDK 7 provides exactly that facility. `ToolLoopAgent` accepts a `toolApproval` policy; a tool mapped
to `user-approval` emits a `tool-approval-request` instead of executing. The caller resumes the same
conversation with a `role: "tool"` message containing a `tool-approval-response`.

## Decision

1. **Use the SDK protocol.** Every destructive tool is mapped to `user-approval` on the
   `ToolLoopAgent`. The first tool is `remove_memory`.
2. **The runtime pauses, not the renderer.** On a request the runtime emits
   `{ type: "approval", turnId, approvalId, name, input }` and keeps the active turn so the same
   conversation can resume. It does not execute the tool.
3. **The author answers through IPC.** `agent.approve(turnId, approvalId, approved)` checks that the
   approval is still waiting, builds the `tool-approval-response`, and resumes the agent with the
   response messages from the paused stream. A denial is passed to the model with a reason; the model
   must not repeat the same request.
4. **Checkpoint before the pause.** If the turn already changed chapters, the runtime saves the
   checkpoint before showing the approval, so those changes remain undoable if the app quits while
   waiting.
5. **The UI shows the affected action.** The chat renders an approval card with Allow and Deny and
   keeps the card after the answer, so the transcript says what happened.

## Consequences

- The first slice covers memory removal, chapter overwrite, chapter delete, line deletion, chapter move,
  split and merge. Library replacement must use the same map before it is added; adding it without an
  approval entry is a review failure.
- A pending approval is not yet stored as a thread part. If the app quits while waiting, the user
  message remains and the approval is not replayed. Persisting approval parts is the next extension.
- The pause stores only one approval. A turn with several destructive calls needs a queue; until then,
  the model should make one destructive call per step.
- Usage totals include every leg of the paused turn; the approval itself costs nothing.
- Memory removal is not chapter-undoable. The checkpoint covers chapter text only; a memory restore
  path needs its own checkpoint if that guarantee is required. Chapter overwrite, line deletion, split
  and merge are checkpointed and undoable; split records the created chapter, and merge records the
  deleted chapter so undo recreates it. Chapter delete moves the file to the trash but is not
  chapter-undoable, and a chapter move changes order only and is not covered by the text checkpoint.

## Alternatives considered

- **A renderer-side confirmation before calling the tool.** The model would still have executed the
  call by the time the card appears, or the tool would need a second custom protocol. The SDK protocol
  is smaller and testable.
- **A blocked tool that returns "ask the author".** It forces another model round trip and loses the
  SDK's typed approval response.
- **Approving every tool.** Too noisy; read and ordinary edit tools stay automatic. Only destructive
  actions pause.

## Testing

`apps/desktop/tests/agent-runtime.test.ts` uses a mock model to prove four things: the memory survives
until approval, Allow removes it, Deny keeps it, and the final assistant text is persisted in the
thread. The tool itself is covered in `agent-tools.test.ts`.
