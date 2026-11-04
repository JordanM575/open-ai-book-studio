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
   approval is still waiting, builds the `tool-approval-response`, and resumes the agent with the same
   conversation: the messages the paused stream was given (the history and the author's prompt, or an
   earlier resume), then its response messages, then the approval. A denial is passed to the model
   with a reason; the model must not repeat the same request. (Amended 2026-11-03: the resume had
   sent the response messages alone, so the model lost the author's request after an approval.)
4. **Checkpoint before the pause.** If the turn already changed chapters, the runtime saves the
   checkpoint before showing the approval, so those changes remain undoable if the app quits while
   waiting. The checkpoint is also written each time the turn changes a chapter, before the tool
   answers the model, so a chapter changed after an approval is in it as well. A turn still has one
   checkpoint file and one undo. (Amended 2026-11-04: the checkpoint had been saved once, at the
   first pause, so a chapter changed after that pause stayed out of it and undo could not restore it.)
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
- Memory removal is not chapter-undoable. The checkpoint covers chapters only; a memory restore path
  needs its own checkpoint if that guarantee is required. Chapter overwrite, line deletion, split,
  merge, delete and move are checkpointed and undoable. Split and chapter creation record the new
  chapter, which undo moves to the trash. Merge and delete record the removed chapter and where its
  file went in the trash; undo moves that file back to its old position, so the chapter keeps its id,
  synopsis, purpose and notes. Only when the file has left the trash, or the recorded path is refused,
  does undo write the title and text again as a new chapter, and it says so. (Amended 2026-11-04: undo had always written a new chapter
  with a new id, and left the original file in the trash.) A move records where the chapter stood, and
  undo moves it back. One move per turn is restored exactly; several moves in one turn are undone
  newest first, and that order is not proven. A chapter's details (`set_chapter_meta`: title,
  synopsis and purpose, with notes, arc, colour and the prologue flag held too) are checkpointed with
  its text and restored by the same undo (amended 2026-11-04). The book's details, cast and memories
  (`update_book_details`, `update_character`, `add_memory`, `update_memory`, `remove_memory`) and a
  plugin's writes are not checkpointed.
- Undo never writes over a later edit. Each entry records a hash of the body text and of the details
  the turn left; a chapter whose text or details changed after the turn is skipped and named, and the
  rest are restored.
- Undo never silently discards words the turn did not write. When a tool finds text or details the
  turn had not left, because the author or another writer changed the chapter between two of the
  turn's writes, for example during an approval pause, the entry is marked. Undo keeps that chapter's
  file as a `conflict-undo` copy in `conflicts/` before restoring it, names the chapter and the copy in
  its result, and leaves the chapter alone if the copy cannot be made (amended 2026-11-04). The copy
  holds the text as it was when undo ran. A mid-turn edit that a later approved `overwrite_chapter`
  replaced in the same turn was already gone before undo ran, so no copy can hold it.

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
thread. It also records every request the model receives: a resume repeats the paused request message
for message before the tool call and its result or denial, a second approval in the same turn runs
each approved call once, and the next turn asks again instead of reusing an earlier approval. The
tool itself is covered in `agent-tools.test.ts`. `turn-checkpoint.test.ts` drives whole turns through
the same mock: a change after an approval, two approvals, a denial after an earlier write, created,
deleted, moved and split chapters, a chapter's details, a chapter the author edits during an approval
pause, and a chapter the author edits afterwards. Undo restores every chapter the turn reported
changed, or skips and names the one edited since; a deleted chapter comes back from the trash with its
id, and an edit made during the turn is kept as a conflict copy first.
