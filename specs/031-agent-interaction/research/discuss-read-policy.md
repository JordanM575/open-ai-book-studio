# Discuss default and read-tool policy (031 T001)

> Status update, November 7: the recommendation was accepted on November 3 as D-177 in
> `docs/DECISIONS.md`. The original research below is retained; runtime delivery remains open.

Status at research: not accepted. This document records the classification facts
and the read-only subset seam behind the T001 decision, and proposes D-177. It
authorizes no composer, runtime, or schema change; T004–T008 still wait on
acceptance.

## What must hold

- Discuss never receives a write, destructive, unclassified, or side-effecting
  capability. Unknown capabilities are denied until decided.
- No second writer and no second approval system: Edit turns keep the existing
  checked writer, destructive approvals, checkpoints, and one-turn undo (002).
- Tool definitions and safety tiers stay with 024; plugins stay with 025.
- Guidance, pause, and plan semantics stay with T002/T003.

## Verified facts the policy rests on

- Built-in tiers are implemented in `apps/desktop/src/main/agent/tools.ts`:
  six `read` tools (`table_of_contents`, `read_story_bible`, `read_chapter`,
  `chapter_stats`, `find_in_chapter`, `find_in_chapters`), seven `destructive`
  tools (the approval-gated seven), and nine `write` tools by default — 22 in
  all. Pinned exactly in
  `apps/desktop/tests/discuss-read-policy-premises.test.ts`.
- `toolTier` defaults unknown names to `write`, so the tier alone cannot gate a
  read-only turn: the Discuss subset must name its tools explicitly. Unknown
  names are still denied at call time — the bridge throws `unknown-tool` for
  anything outside the built set, withheld plugin names included (pinned in
  `tool-bridge.test.ts`: unknown refusal, destructive opt-in refusal).
- `buildToolSet` already builds a per-turn subset through `disabledTools` (the
  025 withdrawn-tool filter): disabling every non-read tool yields exactly the
  six read tools, each executable (premises pin). Withholding is also enforced
  below the SDK: the bridge refuses withdrawn names as `unknown-tool`.
- Destructive tools pause for the author's approval through the AI SDK
  tool-approval protocol (ADR 0014; pinned in `agent-runtime.test.ts`). A
  Discuss turn offers no destructive tool, so the approval path is unreachable
  there — and the checked writer guards every write below it regardless.
- The plugin contract declares no read-only capability (`PluginTool` carries
  name, description, parameters, and handler only), and the plugin library
  hands out `saveChapter` and `appendToChapter` (pinned in `tool-set.test.ts`
  and the premises). A plugin therefore cannot prove it only reads, so none
  may join the Discuss subset until 025 adds a declared, enforceable
  read-only capability.
- There is no Discuss/Edit mode anywhere today — not in the composer, the
  thread schema, or the runtime. The default and the subset are greenfield
  decisions with existing seams, not refactors.

## Alternatives considered

- **A. Read-only built-ins only, Discuss as the new-turn default
  (recommended).** The six read tools answer explanation, critique, and idea
  questions without touching the book. Least privilege by default; the author
  opts into Edit per turn. Enforcement is three layers deep, all existing:
  the model is offered the read-only subset, the bridge denies anything
  outside it, and the checked writer guards anyway.
- **B. No tools in Discuss.** Rejected: without reads the mode cannot see the
  book, so every "explain this chapter" question would force an Edit turn —
  the write-capable mode — defeating the choice. Conversation text alone is
  not the book.
- **C. Discuss with write tools but a no-write promise.** Rejected: a promise
  is not a capability boundary. The no-write invariant must hold by
  construction (unoffered, uncallable), not by instruction.
- **D. Plugins in Discuss on self-declared read-only.** Rejected: no
  declaration field exists, the handler receives a write-capable library, and
  self-attestation is unenforceable. Needs a 025 contract change first.
- **E. Keep Edit (write-capable) as the default.** Rejected: the unsafe
  default turns every question into a turn that could rewrite the book.
  Authors who want edits choose Edit explicitly per turn.

## Recommendation detail

- The composer offers Discuss or Edit per turn, defaulting to Discuss for a
  new turn. The submitted mode and its permissions are fixed for the life of
  the turn (already required by story 2 acceptance scenario 3).
- A Discuss turn is offered exactly the six read-tier built-ins and no plugin
  tools. Write, destructive, unclassified, and future tools are unoffered and,
  if somehow invoked, denied by the bridge.
- A Discuss turn that needs a write explains that the author can send a new
  turn in Edit mode; nothing is queued, nothing is written, and no approval is
  consumed or bypassed.
- Saved turns record their mode as stored data (T004); the composer selection
  never relabels old turns (story 1 acceptance scenario 3).

## What stays open for later tasks

Composer copy and control (T007), runtime enforcement of the subset (T008),
mode persistence and migration (T004–T006), plan-first and guidance semantics
(T002/T003), and any 025 plugin read-only capability.
