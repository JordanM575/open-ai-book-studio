# First Discuss/Edit slice — implementation decision, November 7, 2026

Base: `1844285e2dbb83e131e691393ed7ec6c9b4c394c`, containing public baseline
`55b55b8` and plan `e46ef95181e5efd74ecf36cfa88ee69d1c18dc99`.

## Current evidence and chosen approach (before implementation)

- D-177–D-179 are accepted. The current runtime ignores `input.mode`, loads plugins
  unconditionally and offers every enabled tool. The composer hardcodes Edit. The
  existing six `READ_TOOL_NAMES` and `toolTier` are the authoritative built-in policy.
- T004 already supplies validated mode/guidance schemas, optional message `mode`, and
  a user `guidance` part. No new storage field is necessary. Preserve mode on the
  submitted user request as well as the assistant outcome so failed requests retain
  their attribution and retries cannot silently reuse a different permission request.
  The coordinator should clarify the existing FORMAT wording (which describes mode
  on assistant messages only); this builder does not edit that shared document.
- Contrary to the stale task note, `prompt.ts` already includes book tone and answer
  length. Keep that path, validate before provider access, and clarify that reply
  length does not limit manuscript prose. One-turn guidance will be a separately
  identified request instruction, recorded verbatim in its existing part, omitted
  from later history-to-model conversions, and cleared from the composer on send.
- Snapshot request values before the first await. Reject missing/invalid mode and
  oversized guidance before any provider lookup or thread write. Use one closed
  policy for tool-set construction and optional mode-aware ToolBridge calls; keep
  disabled tools effective. Discuss never loads plugins, including module top-level
  code. SDK tool-set omission prevents dispatch of fabricated names; tool execution
  wrappers and bridge checks independently enforce the captured policy.
- Default every fresh composer request to Discuss, including after an Edit send.
  Keep retry requests fixed. Disable pre-send guidance/mode controls while running;
  display saved attribution, with legacy mode explicitly unrecorded. Explain the
  new Edit-turn step in the UI and mode instructions, including denied calls.

Rejected: prompt-only enforcement, `activeTools` with write handlers still bound,
plugin self-attestation, sticky Edit permission, replaying guidance as historical
instructions, and silently truncating author guidance. No plan/lifecycle expansion.

## API research

Context7 was attempted first and returned “Monthly quota exceeded.” The official
AI SDK reference was then read at
<https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent> on November 7.
It documents `tools` as the callable set, `toolApproval` as separate per-tool
approval policy, and `instructions` as the request instruction boundary. Preserve
the existing SDK 7 call shape and approval protocol. The current docs also expose
experimental steering; this does not change D-179's explicit exclusion or authorize
using it. No provider request was made by this research.

## Verification and delivery boundary

Focused synthetic tests will inspect actual mock-model tool definitions, fabricated
write/destructive/plugin/unknown calls, byte-identical book/chapter preservation,
Edit approval and undo, request fixity, exact guidance limits/scope, and composer
selection/history/retry behavior. Run typecheck. Integrated app, visual, accessibility,
film and broad regression gates remain with the coordinator.

The accepted matching re-shoot, script and runbook delivery condition remains.
The demo must explicitly select Edit before its writing requests; a Discuss request
must demonstrate read-only behavior. Existing recordings do not prove this slice.

### Budget finding and refinement before the final request implementation

The expanded synthetic large-book budget test measured 4,913 system tokens with
maximum one-turn guidance embedded in the system text. Keep the existing 4,000-token
system budget: one-turn guidance belongs in the current user request, alongside its
prompt, and nowhere in later user history. The fixed mode policy remains in system
instructions. Context accounting includes the exact current request text. This is
the same boundary as ordinary author requests, preserves all guidance, and avoids
reducing book context or relaxing a budget gate. Book tone remains in the existing
system section. Verify maximum tone and mode within the static system budget,
and exact guidance delivery/isolation at the mock-model boundary.
