# ADR 0019: Bounded, durable autonomous authoring

**Status:** Accepted, November 7, 2026, under the author's delegated feature-delivery authority.
**Decisions:** D-194–D-196, D-113 and D-116. **Owners:** 031/036/037.

## Context and selected outcome

The retained journey is a short brief (about 100 words), small onboarding and ongoing work toward
an author-visible target such as 70,000 saved words, with asynchronous specialists, editorial
revision and character-direction check-ins. Ordinary background turns and foreground review remain
useful separate operations. This decision authorizes implementation of the complete journey;
it is not evidence that the journey is implemented or that generated books have literary quality.

Use a deterministic host coordinator over a book-owned task DAG. Separate architect, character
planner, drafter, developmental reviewer, line/continuity reviewer, revision writer and canon
summarizer attempts have immutable inputs and attributable outputs. Workers may read only their
captured context and produce candidates. Only the existing Library-owned checked publisher can
adopt a candidate. Plugins, shell, MCP, arbitrary URLs and external publication are excluded from
workflow capabilities. Ordinary trusted local plugins remain a separate feature.

## D-194: Scope, permission and human direction

The author explicitly starts an agreement naming owner book/library registration, destinations
and role profiles, selected source policy, allowed tasks, publication targets, limits and check-ins.
The default source policy includes the new run's generated artifacts and adopted successors;
manual/external source changes require reconfirmation. It never selects unrelated books or files.
There is one active run owner per book. A copied grant descriptor is not execution permission.

An owner-only host permission record, outside the library/archive, binds library registration,
book/run, policy digest, generation, expiry, revocation and resume preference; it contains no prose
or credential. Only an explicit validated author action creates or extends it. Missing, corrupted,
changed or foreign-host permission requires reauthorization without losing artifacts. This is an
application authority boundary, not authentication against arbitrary code running as the OS user.

Automatic adoption/revision is permitted only for opted-in run-created targets with verified
publication lineage, unchanged exact source and a clean editor. Existing author text, manual/tool/
external edits, destructive restructuring and increased scope/spend require fresh action-bound
authorization. Never inject an automatic approval into ordinary destructive tool calls. Protect
the target from the first dirty keystroke, before debounce; unknown draft ownership blocks adoption.

Onboarding retains the exact brief (up to 20,000 UTF-16 units and 65,536 UTF-8 bytes), optional
genre/audience/perspective/tone/constraints, and one 033 goal. About 100 words is guidance, not a cap.
Offer local Save setup with zero sends. The working agreement explains background behavior and
cost mode. Outline/cast proposals require the first direction check. Default further check-ins:
after the first adopted chapter, then three more adopted chapters or 10,000 more saved words,
whichever occurs first, plus major irreversible character/ending choices. Cadence is editable.

Questions have stable run/question/character IDs, revision, source evidence, concrete options plus
free text, consequences and blocked dependencies. Silence/dismissal never answers. A confirmed
answer creates immutable versioned direction, closes affected publication gates synchronously and
invalidates dependent attempts. Provably independent work may continue. Unknown dependency impact
is conservative. A live attempt's prompt never changes; follow-up work is a new attempt. Voice and
text share these intents, but a voice session alone cannot grant workflow authority.

## D-195: State, ownership and recovery

One coordinator belongs to the actual open Library; callbacks stay pinned to that instance and
generation. Hold its existing book queue only for short state/read/commit work, never provider I/O,
approval or timers. No second mutex or filesystem writer substitutes for Library ownership.

Ordinary files under `books/<bookId>/workflows/<runId>/` hold checked `run.json`, immutable
`brief.json`, `plans/` and `directions/`, checked `tasks/`, `attempts/`, `effects/` and `questions/`,
and immutable `artifacts/` (Markdown or JSON). Every record has schema/kind, owner/host-issued ID
and appropriate revision; references carry kind/owner/ID and exact raw hash, never supplied paths.
Control selects the graph/direction/generation; tasks own execution state; attempts own dispatch
and accounting; effects own publication receipts. Aggregate progress is a rebuildable projection.
Cross-file operations are recoverable sequences, not transactions. Detailed wire schemas must be
added to FORMAT and reviewed before the first writer. Pure contracts/reducers can proceed now.

| Entity | Required progression |
| --- | --- |
| Run | local setup → authorized planning → active/needs-direction → final-review-ready → author-finished; pause/cancel have separate settling states |
| Task | blocked → ready → preparing → executing → validating/reviewing → ready-to-publish → adopted; failed, stale and uncertain are explicit alternatives |
| Attempt | prepared → dispatch-intent → receiving → output-kept → complete; failed/stopped/uncertain never imply no charge |
| Effect | prepared → publish-intent → confirmed/conflict/not-published/uncertain |
| Question | open → answered/superseded/withdrawn; stale answers refuse |

Command IDs deduplicate only equal payload digests; same ID with different payload refuses. Safe
integer revisions/generations refuse overflow. Read/validate plain, acyclic, losslessly serializable
values; reject duplicate keys, invalid UTF-8, lossy numeric tokens, future versions and unsafe IDs
without rewriting. Preserve supported unknown fields and complete recoverable conflict candidates.
No automatic pruning. Archive and whole-book trash carry these author files; host permission does not.

Initial bounds are chosen engineering policy, pending scale measurement: 2,500,000 exact serialized
UTF-8 bytes per run/phase plan, 1,024 tasks per phase; 262,144 bytes per task/attempt/effect/question;
1 MiB per candidate prose or editorial artifact; 64 queued task references and four materialized
requests. Linked phase plans allow longer work without truncation. All intersecting limits apply;
bound reads/streams before allocating the whole value. Overflow preserves existing durable data.

Publication validates current grant, generation, graph, direction, exact artifact, required reviews
and clean target. Compare both saved version and raw hash before recognizing even a no-op. For a
new chapter preallocate an absent ID/path in the effect; for replacement keep verified safety first.
Persist exact intended serialized bytes and publish-intent before a single checked commit. Verify
returned/readback bytes and record the result separately from catalog/thread/accounting projection.
Failed projection never invites another write. Candidate counts never substitute for verified saved
goal progress. An optional provenance marker requires its own FORMAT field before being written.

Prepared-without-dispatch is known unsent only under this protocol. A persisted dispatch/publish
intent without a conclusive receipt is uncertain. Exact intended bytes found on recovery mean
**intended result observed**, not proof of writer identity; do not repeat the effect. Different,
missing or even unchanged-base bytes after a publish-intent are not permission to retry. There is
no claim of cross-process filesystem CAS or exactly-once provider execution/charging.

Pause/revoke closes admission/publication gates before awaiting persistence; settled state follows
actual in-flight outcomes. Persistent revoke failure keeps the local gate closed and disables
auto-resume. Window closure may continue work under its grant, with durable inbox notifications.
Sleep/quit stops execution; no daemon or startup service. Default restart performs local recovery
and requires Continue. Explicit same-host resume-on-open may schedule only safe fresh work under
an unexpired grant. Uncertain attempts are never blindly replayed. Library replacement/trash first
quiesces pinned work. Forced process death is recovered from already durable intents, not quit hooks.
Generic notifications reveal no manuscript; opening one navigates, never answers a question.

## D-196: Admission, routing and bounded iteration

Default host concurrency is three model requests, configurable from one to four, restricted further
by account/provider capacity. This is independent of the five development-worker slots. Pin explicit
role-to-connection/model choices; no ranking, fallback or replacement is inferred. 036's offline
preview remains selection-neutral and performs no dispatch; workflow routing is a distinct operation.

Initial agreement: 600 provider calls, 12 accumulated active hours, seven calendar days, at most two
local revision cycles per chapter and one whole-book targeted revision pass. Each charged continuation
counts, including bounded read continuations (four calls/eight local reads per attempt). Default SDK
step limit is one and retries zero. Per-call output-token ceilings: planning/revision 8,192, scene/
editorial 4,096, canon 2,048, intersected with adapter and byte bounds. No automatic budget renewal.
The reference 28-chapter/70k-word workload has a design estimate of 486 calls, not runtime evidence.

Every attempt checks/reserves limits before send and publication. Duplicate commands cannot reserve
twice. Expiry/pause stops new work; cancellation frees only known-unsent reservations. Repeated equal
input/direction/review/policy digests, unchanged revisions and exhausted cycles park for direction.
Zero automatic provider retries: a failed branch waits; unrelated work may proceed. A 429 timestamp
sets earliest eligibility, not a scheduled resend. Auth/quota failure parks the connection. No-ready
work waits on a state event rather than asking the model repeatedly what to do.

D-116 selects two cost modes: **bounded operations**, explicitly not a dollar cap and allowing unknown
actual cost; and **strict money**, requiring a qualified provider-enforceable upper bound including
all charges. Strict mode durably reserves conservative maxima across concurrency; unknown tariff,
unresolved charge or unavailable enforcement refuses admission. Catalog estimates/local abort do not
prove a ceiling. Monetary arithmetic uses safe integer micro-USD, conservatively rounding maxima up;
overflow refuses. Existing informational thresholds remain informational until explicitly converted.
No live adapter is certified here. Known subtotal, unknown/partial calls and reservations remain
distinct; failed accounting persistence closes dependent admission without relabelling saved prose.

## Shared conversation prerequisite: D-113

Select checked whole-document conversation revisions with raw-hash expectations and the same Library
queue; migrate every caller off unchecked `any` writes. Issue-bearing reads preserve supported unknown
plain data; future/unknown semantic parts are read-only. V1 remains readable losslessly; new semantic
parts use v2 only after explicit migration with original-byte backup. No migration on open. Recoverable
trash/restore verifies source and absent destination; no direct unlink or automatic pruning. Ordinary
replay allowlists run before compaction, excluding whole review/workflow lineages and their summaries.
One live/settling owner per attempt thread; root conversation links milestones instead of embedding
every full-text artifact. Materialization ceiling: 64 MiB legacy threads, 8 MiB new attempt threads;
oversized originals remain raw/unavailable. Parser depth 64 is selected for new workflow records;
the old million-node/128-MiB-queue proposals are not adopted without profiling. Ordinary checkpoint
compatibility stays intact; a full-book run is not one turn and has no fictional whole-book Undo.

## Constitutional amendment and evidence

Principle 3 now distinguishes unsolicited network traffic from an explicitly started, bounded,
revocable workflow or voice session. Principles 1/2/5/7 remain binding. D-126 remains per-turn for
ordinary chat; D-178's restart expiry/explicit Send applies to ordinary 031 plans. D-179 retains
immutable in-flight input while permitting new direction epochs between workflow attempts. Current
AI SDK steering APIs exist, but this design deliberately does not use in-flight semantic steering.

Required separate gates: protocol/fault/authority tests; actual UI→pipeline→saved ~70k synthetic book
(63k–77k reference target band, complete chapters/ending, revision/check-in/restart, not preseeded
output); independently evaluated live literary quality; usability; actual host/voice/device and
release evidence. Finishing short needs an explicit author choice. A live rubric must be declared
before paid evaluation; the research's numeric literary scoring proposal is not certified here.

Alternatives rejected: repeated ordinary start calls, one enormous prompt, workers writing directly,
hidden authoritative database, external hosted scheduler, blanket overwrite authority, and a
candidate-only manual-Apply workflow as the final completion boundary.

Evidence: existing runtime/ThreadStore/Library/checked-sidecar source, completed November 7 autonomy
and requirements audits, [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control),
[Electron lifecycle](https://www.electronjs.org/docs/latest/api/app) and
[power events](https://www.electronjs.org/docs/latest/api/power-monitor), accessed November 7.
Documentation and workload arithmetic do not establish implementation, performance or live quality.
