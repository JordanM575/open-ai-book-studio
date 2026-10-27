# 0013 Agent message and thread format

**Status:** Accepted
**Supersedes:** none
**Related:** [0007](0007-agent-runtime.md), [0009](0009-multi-target-storage.md), [0010](0010-bun-and-workspaces.md)

## Context

The studio streams text, reasoning and tool activity from the main process, but it does not store a
conversation. The renderer keeps messages in `useState`, and the next turn receives the last 20
turns as plain text with tool activity removed. A reload loses the chat, and the model cannot see
what a tool returned earlier.

The legacy app stored AI SDK `UIMessage` JSON in browser storage. That worked for one Next.js target,
but it ties the saved format to an SDK version and cannot be the contract for a desktop file library,
the web build and a future sync surface.

## Decision

1. **The studio owns the message format.** `packages/core/src/agent/messages.ts` defines
   `AgentMessage`, `AgentPart` (text, reasoning, tool call, tool result, source, file, error),
   `AgentUsage`, `AgentThread` and their Zod schemas. Messages carry the model and usage for the turn
   that produced them.
2. **Conversations are files.** `ThreadStore` in `packages/core/src/agent/threads.ts` reads and writes
   `books/<bookId>/threads/<threadId>.json` through `LibraryPort`, using the same atomic commit as
   every other library file. The store validates ids, parses on read, skips corrupt files when
   listing, and reports a corrupt file when it is opened directly.
3. **AI SDK types stay at the edge.** The runtime converts `AgentMessage` to `ModelMessage` before a
   provider call and converts streamed parts back. `UIMessage` is an adapter concern for any client
   that wants it, not the storage contract.
4. **Tool activity is stored, not replayed as prose.** A turn can be resumed, inspected and branched
   without asking the model to reconstruct what happened from a summary.

## Alternatives considered

- **Store AI SDK `UIMessage` JSON.** Less mapping code, but the saved conversation changes whenever
  the SDK does, and provider-specific parts leak into every target.
- **Keep plain-text history.** Smallest change, but it loses reasoning, tool results, usage and the
  ability to resume a thread. The legacy app already proved that tool-result loss causes repeated
  edits.
- **A hidden database.** Rejected by the product's first principle: the files must be able to
  rebuild every derived surface, including the catalog.

## Consequences

- The runtime and renderer need a conversion layer; it lives beside the runtime, not in components.
- Thread files are part of the library format. `docs/FORMAT.md` must describe them before the runtime
  starts writing them.
- A future sync surface can compare thread files like chapters, but conflicts in a conversation need
  a policy; this ADR does not define one.
- The first implementation writes one file per thread with no cross-thread index. The catalog can
  index threads later; the index stays disposable.
