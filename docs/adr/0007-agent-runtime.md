# ADR 0007: Use the Vercel AI SDK as the agent runtime

- **Status**: Accepted
- **Supersedes**: the earlier draft direction to adopt `@openrouter/agent`
- **Related**: spec 002 FR-021…FR-034, constitution principle "one checked writer"

## Context

The studio needs a multi-turn tool loop: a model reads context, calls our editing tools, sees results,
and continues until it stops. We write the tools, the limits, the prompts and the approval rules. The
question is only who owns the loop, the streaming transport and the usage accounting.

Constraints:

- Authors bring their own OpenRouter key. We are not tied to one model vendor and must not require an
  account with one.
- The loop must be observable: per-step usage, cost, finish reason, tool calls, and a way to stop.
- Tool arguments must be validated before they touch the manuscript.
- The API must be stable enough to ship, and replaceable without rewriting the tools.
- We already know this stack: an earlier studio ran Vercel AI SDK 7 in production, and its
  failure log (F-030, F-032, F-034, F-035) documents exactly where the integration is fragile.

## Decision

Use **Vercel AI SDK 7** (`ai` 7.x) with **`@openrouter/ai-sdk-provider`** as the agent runtime.

- Build the agent with `ToolLoopAgent`, configured with `instructions`, `tools`, `stopWhen:
  isStepCount(n)`, and `onEnd` for usage, cost and checkpoint bookkeeping.
- Define every tool with the SDK's `tool()` and a Zod `inputSchema`; the tool's `execute` calls the
  main-process `Library` service. No tool touches files directly.
- Convert stored UI messages with `convertToModelMessages` and stream with `messageMetadata` carrying
  usage and cost to the renderer.
- Keep the loop behind `src/main/agent/runtime.ts`. The rest of the app depends on that module's
  interface (start, stream events, stop, usage), never on SDK types.
- Total usage across steps comes from the result's `usage`; a per-step figure is never presented as the
  turn total (the F-034 lesson).

Rejected alternatives:

- **`@openrouter/agent` (0.11.x)** — the official OpenRouter agent SDK is a good fit on paper: hooks,
  approvals, MCP, `stopWhen`, session state. It is pre-1.0, its API surface is large and moving, and
  adopting it would put a second opinionated abstraction between us and the provider we already reach
  through the AI SDK. It remains the fallback if AI SDK 7 becomes unmaintained; the adapter boundary
  makes that swap mechanical.
- **OpenAI Agents SDK** — provider-native; using it with OpenRouter needs a custom model provider, and
  it pulls the design toward OpenAI-hosted features (tracing, hosted tools) that contradict the
  no-telemetry, bring-your-own-key stance.
- **Claude Agent SDK** — couples the product to Anthropic models and, in practice, to the Claude Code
  harness; authors could not choose their own model.
- **A hand-rolled loop** — an earlier studio's own harness is the source of most of its agent
  defects (replayed tool results, stale book state, opaque usage). Owning the loop is not a feature.

## Consequences

- We inherit the SDK's release cadence and its breaking changes between majors. Pin the minor version,
  read the migration guide before upgrading, and keep the adapter thin.
- Approvals and pause/resume are ours to implement: destructive tools are declared with a risk level
  and the loop pauses for the renderer's decision. The SDK's tool-approval facilities are used where
  they exist, not reimplemented.
- Usage and cost are read from the provider through the SDK; where the provider reports no price, the
  interface says unknown rather than zero.
- The tools stay SDK-agnostic in shape (name, description, Zod schema, execute), so moving to
  `@openrouter/agent`, or to a future SDK major, is a change in one file plus the event mapping.
- The prompt budget, snapshot and consistency tests treat the assembled request as data, independent
  of which runtime sends it.

## Testing seam

`AgentRuntime` accepts an optional model factory, defaulting to `modelFor`. Contract tests inject AI
SDK `MockLanguageModelV4` and `simulateReadableStream`, so a full turn — thread write, usage, events
and a tool loop — runs without a provider key or network. The Meta adapter will use the same seam, and
the tests will keep provider behavior behind the adapter.

## Harness update

Vercel published `@ai-sdk/harness` (1.0.x, explicitly experimental) with adapters for Claude Code,
Codex, OpenCode, Cursor, Copilot, Pi, Cline and others. A harness is a complete agent runtime that owns
its own workspace access, built-in coding tools, conversation history, compaction and permission flow;
our tools can be attached to it. It is the closest thing to "use a known harness instead of writing our
own loop", so it was evaluated against this decision.

It does not change the decision, for three reasons:

1. **It cannot run in the browser.** Every adapter needs a sandbox: a bridge-backed adapter runs a CLI
   process and a WebSocket to a network sandbox (the documented path is a Vercel sandbox with an OIDC
   token); even the host-process adapters require a sandbox session. The product must also run in a
   browser (ADR 0009), and a cloud sandbox would upload the manuscript and require credentials of ours.
2. **It would bypass the save protocol.** A harness writes files with its own tools. Our version, hash,
   conflict and checkpoint rules live in the store; letting a harness edit the workspace directly
   reintroduces exactly the class of defect the foundation was built to remove.
3. **It is experimental.** The package warns of breaking changes, and its adapters are versioned in
   lockstep with the SDK. Pinning it would put an unstable dependency in the path of every manuscript
   write.

Harness runtimes are therefore **deferred**, not rejected. The runtime seam stays
`src/main/agent/runtime.ts` (later `src/core/agent/runtime.ts` with a host adapter), so a future
desktop-only option can offer "bring your own coding harness" without touching tools, prompts or the
store. Revisit when the API is stable, a local sandbox ships, and the harness can be pointed at an
OpenRouter key without a workaround.
