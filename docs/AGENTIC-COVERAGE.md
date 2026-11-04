# Agentic coverage audit

**Checked:** 2026-10-26, branch `015-web-target`, commit `5ea08e9` (a pre-event commit); prompt, context, approval,
per-turn model and untrusted-data rows updated after that audit.
**Question:** do the specs cover the full agentic suite?

## Verdict

The specs describe a solid v1 agentic *writing assistant*. They do not describe the full agentic
*suite*, and the implementation is narrower than the text in two consequential places: approvals
(library replacement is still ungated) and safety/evaluation. Conversation persistence, history
compaction and the editing surface are now implemented; the spec's conversation lifecycle remains
unspecified.

Three labels are used below:

- **Covered** — the requirement exists and the code satisfies it.
- **Gap** — the requirement exists but the code does not satisfy it.
- **Unspecified** — no requirement exists, so nobody has decided the behaviour.

## Covered and implemented

| Requirement | Where | Implementation |
| --- | --- | --- |
| Manuscript changes only through tools | 002 FR-021 | `createChapterTools` and `ToolLoopAgent`; no prose-paste path |
| Untrusted author data | 002 FR-023a | The prompt wraps author, Story Bible and chapter data in `<untrusted_context>` and forbids following instructions inside it; chapter, Story Bible and search tools repeat the data warning |
| Untrusted material guard | 002 FR-023a | The prompt wraps book, Story Bible and chapter data in `<untrusted_context>` with a data-not-instructions rule; chapter, Story Bible and search tool descriptions repeat the warning |
| One stated limit per tool | 002 FR-022 | Zod input limits in `apps/desktop/src/main/agent/tools.ts` |
| Stop a turn coherently | 002 FR-025 | `AbortController`, `stopped` event, checkpoint before exit |
| Approval survives a reload | 002 FR-024/FR-024a | The approval part is stored on the turn message, updated on allow, deny and stop, and reloaded into the same Allow/Deny card |
| Preserve the author's concurrent edits | 002 FR-026 | `baseVersion`/`baseHash` save protocol and conflict copies |
| Checkpoint and one-action undo | 002 FR-027 | `CheckpointStore`, `agent.undoLast`, undo survives reload |
| Friendly tool summaries | 002 FR-028 | `ChatPanel` `toolLabel` keeps the main line plain; raw input/output sits behind a closed Details disclosure |
| Provider usage and unknown cost | 002 FR-029 | `UsageStore`, `stream.totalUsage`, OpenRouter reported cost, context percentage and a per-section estimated prompt breakdown |
| Refuse models without tool support | 002 FR-031 | Provider registry and model picker gate |
| Author-facing language | 002 FR-033 | Prompt "How to reply" rules; no tool names or ids |
| Book default connection and model | 011 FR-028 | `book.defaultConnectionId`, `book.defaultModelId` |
| Record model per turn | 011 FR-030 | `done` event carries provider, model and connection label |
| One-off model override | 011 FR-029 | `AgentTurnInput` carries an optional connection/model; the runtime validates it, records it on the turn and leaves the book default unchanged; the chat composer opens the picker in turn mode |
| Usage totals across all steps | 011 FR-034 | `stream.totalUsage`, not the last step |
| Failed turn keeps its request | 011 FR-039 | Retry map; retry withheld when the turn changed chapters |
| Model change visible | 011 FR-031 | `model-change` separator in the conversation |
| Shorten history before sending | 002 FR-030 | `compactHistory` keeps the last six user turns verbatim and summarizes older tool activity; the stored thread is unchanged |
| Story Bible reaches the agent; instructions snapshot-checked | 002 FR-020 | Prompt carries book description, saved memories and character description/motivations/notes; `read_story_bible` returns every field; snapshot test added |
| Base prompt under 4,000 tokens | 002 FR-032 | `gpt-tokenizer` o200k_base budget test on a 120-chapter, 30-character, 20-memory book; worst case 3,384 tokens |
| Full editing surface | 002 FR-023 | 22 tools cover read, find, insert, delete lines, replace, overwrite, append, create, move, split, merge, delete chapter and Story Bible read/update |
| Context overflow remedy | 011 FR-042 | The error reports the model's context limit and offers a larger model or a new conversation |

## Covered but missing

| Requirement | Gap | Evidence |
| --- | --- | --- |
| 002 FR-024 — destructive actions need in-turn approval | `remove_memory`, `overwrite_chapter`, `delete_chapter`, `delete_lines_in_chapter`, `move_chapter`, `split_chapter` and `merge_chapters` pause with the AI SDK user-approval protocol, an IPC answer and an Allow/Deny card. The request and decision are stored on the turn message. Library replacement is not gated yet. | `runtime.ts`, `ChatPanel.tsx`, ADR 0014 |
| 002 FR-027 — checkpoint history not pruned below a useful history | Only the latest checkpoint is read, and undo deletes it. One level, then nothing. | `CheckpointStore.latest`, `remove` |
| 002 FR-034 — check a word or length constraint after a rewrite | Tools return `wordCount`; nothing compares it with a requested constraint or reports the saved count. | `tools.ts` |
| 011 FR-035/036 — cost display and plan attribution | OpenRouter's reported final-step cost is displayed; other providers remain unknown and plan attribution is blocked by 011 tasks. | `runtime.ts`, `openrouter.ts` |


## Unspecified by any spec

- **Conversation persistence and lifecycle.** 002 lists "Conversation and turn" as an entity and FR-030
  says "stored conversation". The studio now stores, reloads, renames, branches and deletes threads
  (ADR 0013), but no requirement defines export.
- **Approval protocol.** FR-024 requires approval. The studio uses the AI SDK user-approval protocol
  (ADR 0014), stores each request and decision on its turn, and reloads it into the same card. A full
  app restart cannot resume a paused turn; answering the old card reports that it expired. No spec
  defines batching, timeouts, remembering a choice or automatic expiry after a restart.
- **Context assembly.** `compactHistory` shortens old turns, but no per-section budget, retrieval
  rule, summarisation policy or memory ranking is specified.
- **Prompt-injection evaluation.** The prompt now labels author/Story Bible data and tool results as
  data, not instructions, and escapes its own delimiters. There is no adversarial transcript or
  evaluation suite yet.
- **Evaluation of agent quality.** 012 is Draft with no `tasks.md`; there are no golden transcripts,
  tool-selection evals, edit-fidelity checks or refusal tests.
- **Planning and step visibility.** No plan/todo tool or progress surface; FR-028 only forbids
  "Analysis / Plan" headings.
- **Memory lifecycle.** Author-side CRUD exists (FR-019), but agent-side read, update, remove, dedupe and
  importance ranking are unspecified.
- **Spend caps.** Usage is recorded, but no per-turn or per-book budget can stop a run.
- **Library-wide agent search.** Book search exists for the author (FR-009); the agent has no search tool
  and cannot find text outside the chapter it reads.

Out of v1 scope but part of a "full agentic suite": subagents, background or scheduled runs,
multi-book reasoning, and voice/illustration tools. 002 treats illustration and read-aloud as separate
product features, not agent tools.

## Recommended shape

1. **Amend 002** with requirements for conversation persistence, the approval protocol, prompt-injection
   safety, memory lifecycle and a token-based prompt budget.
2. **Write `017-agent-suite`** if those become one capability: conversation storage, complete tool
   surface, approvals, context assembly, safety and evaluation. Keep 002 as the product contract.
3. **Give 012 a `tasks.md`** and an agent-eval section: recorded provider exchanges, golden transcripts,
   tool-choice accuracy, edit fidelity, refusal and injection cases.
4. **Two ADRs**: conversation storage (files under `threads/`, per book, rebuildable index) and approval
   ownership (main-process policy, renderer prompt, auditable outcome).

## Suggested implementation batches

| Batch | Work | Requirements |
| --- | --- | --- |
| A | **Done** — 22 tools cover the editing surface; library replacement remains a separate approval-gated action | 002 FR-023 |
| B | **Partly done** — `remove_memory` has request, allow/deny and checkpoint-first; batch summary, other destructive tools and a smoke journey remain | 002 FR-024, ADR 0014 |
| C | **Partly done** — threads persist, reload, rename, branch and delete, `compactHistory` shortens old turns; full tool-part replay remains | 002 FR-030/FR-031, 011 FR-031 |
| D | **Done** — prompt carries memories and character detail; `read_story_bible` returns the full bible; snapshot and 4,000-token budget tests added | 002 FR-020/FR-032 |
| E | Plan cost (the injection guard, per-turn model override, context use, breakdown and overflow remedy are done) | 002 FR-023a/FR-034, 011 FR-035 |
| F | Agent evals and contract fixtures | 012 |

## Verification baseline

- `bun test` — 308 pass.
- Desktop hidden smoke — 16/16.
- Web hidden smoke — 11/11.
- Chromium real-storage matrix — 12/12; Firefox/WebKit OPFS findings recorded.
- Packaged desktop smoke — 16/16.
