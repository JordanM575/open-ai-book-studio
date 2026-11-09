# Conditional campaign continuation format

**Status:** Accepted by [D-201](../DECISIONS.md#d-201--conditional-campaign-continuation) and
[ADR 0020](../adr/0020-inline-editorial-review.md#d-201-conditional-campaign-continuation).
This document specifies the wire and operating contract. Pure in-memory codec leaves implement
part of that contract, including pure compatibility dispatch, bounded source validation and
compatible replan. Checked storage slices now add a version-dispatching storage reader,
intent-first publication and explicit recovery classification over the Library queue, plus
whole-group trash/restore and cross-book report resolution (below); they do **not** establish
host execution, a portable archive/export workflow or a general adapter qualification, and
independent review remains required.
[FORMAT](../FORMAT.md#saved-review-records-schema-1) continues to specify the separate existing
schema-1 records.

The representation is lossless for complete planner content excluding its `digest`, **conditional**
on obtaining the exact external values and passing compatible planner validation. Missing originals
leave retained structure inspectable but reconstruction and continuation unavailable. This is not a
self-contained archive or a guarantee of offline availability. No save implicitly captures 032
history, conversations, generated summaries or provider payloads; no stored value or reference grants
execution authority. A self-contained retention/encryption/recovery design requires a separate
decision. Ordinary review request, report, disposition, profile and history rules remain unchanged.

### Current pure implementation and its boundary

The `packages/core/src/review/campaign-continuation-*` leaves provide an in-memory candidate builder,
canonical token/segment packing, manifest and publication-intent inspection, checkpoint checks,
exact-hole reconstruction and comparison with a caller-supplied locally provenanced plan. The
builder accepts only `requireCampaignPlan` results; it returns candidate bytes, not a saved or
authorized campaign. Revisions require a prior locally provenanced plan and referenced bytes. They
preserve supported mapped unknowns and exact reusable segments, and refuse conflicting or unmappable
unknown data. The additive bounded canonical-byte visitor does not change ordinary record limits.

`inspectContinuationWire` and `resolveContinuationWire` return structural-only results. Resolution
checks exact external values, expansion counts and the plan digest, but alone does **not** validate
source identity, all manifest counts, coverage, dependencies, envelopes or planner semantics.
`compareContinuationWithLocalPlan` additionally requires exact complete comparison and checks counts,
planned union and checkpoint shape against an independently supplied local plan; it does not register
the decoded object, authenticate source files, verify report files or authorize execution. The
`campaign-continuation-replan` leaf adds the pure compatible-replan/source-validation seam of §6:
it dispatches on the recorded schema version and `plannerSemantics`, validates explicitly supplied
current or historical raw source files against the retained identities and bounds before planning,
replans only through the real planner, and returns `matched-local-plan-only` with that fresh
provenanced plan or a bounded refusal; a differing but compatible semantics label is never served
unchanged, and hash agreement alone never registers a plan.

`packages/core/src/review/campaign-continuation-store.ts` (`LibraryService.campaignContinuations`)
adds the checked storage slice of §7.1–§7.2 for one campaign: owner-explicit bounded reads that
load a retained continuation only through the codec wire readers and the replan dispatch
(current semantics served only through a locally provenanced plan, compatible labels returned
as `replan-required`, everything else refused), intent-first publication of the exact candidate
bytes (immutable intent, then immutable segments in manifest order, then the checked manifest
last, with fresh readback of every reference by length, raw hash and semantic ID before
`published` is reported), and explicit per-intent recovery classification (`already-published`
as a byte observation, `prepared`, `incomplete-draft`, `conflict` or `uncertain`, with missing
and divergent segments named). Segment and intent files are created only through a genuine
no-replace creation seam (`LibraryPort.createImmutableFile`, implemented by the desktop
filesystem adapter with exclusive creation); an adapter without that seam refuses publication
before any write instead of using a check-then-rename commit, and the checked manifest commit
still does not claim cross-writer atomic CAS. The same store, with the pure
`campaign-continuation-group` leaf, now also implements §7.3 group trash/restore and the §5
cross-book report read: an immutable group intent is written and read back before exactly the
segment directory, publication-intent directory and manifest file move (manifest last) between
`books/<ownerBookId>/reviews/` and `.studio/trash/<ownerBookId>/reviews/campaign-<groupId>/`,
after version dispatch, full wire verification and bounded inventory/destination preflight at
the source, so a move that cannot preserve every checked reference refuses before the first
move and a later failure is uncertain with both locations retained; checkpoint reports are
read only from their recorded owner's ordinary report path, the recorded owner wins, a verified
foreign report is a bounded foreign reference that is never adopted, merged or dropped, and a
missing or changed report stays unavailable. The same store, with the pure
`campaign-continuation-fixed-history` leaf, now also implements §7.4 fixed-history
trash/restore: the owner book's entire 032 `history/` tree moves with the campaign's segment
directory, publication-intent directory and manifest (history first, manifest last) under an
immutable fixed-history intent, after the same manifest dispatch (compatibly differing labels
only through a local normalized comparison copy, stored bytes never altered) and wire
verification plus per-record 032 dispatch and bounded inventory preflight, with the same
refuse-before-first-move and uncertain-after-first-move guarantees and
`active`/`archived`/`partial`/`absent` inspection that never reads partial as complete.
The pure `campaign-continuation-checkin` leaf (039 T018 seam 6a) maps one checked campaign —
the store readers' inspection, cross-book report resolution and group/fixed-history
inspection results, plus a host-supplied 037 run owner and direction reference — into counted
037 check-in inputs copied verbatim from the manifest and its codec `counts` (campaign and
owner identity, revision, segment/token totals, selected scalar/byte counts and checkpoint
receipt tallies). It refuses stale expectations, partial or non-active groups, cross-book
artifacts, refused or compatibly differing semantics labels and campaigns too large for one
037 context/phase, and it never recounts prose, re-encodes stored bytes or mutates its
inputs, so supported unknown fields survive untouched. The codec retains no word count and
there is no campaign-stage task role and no derivation for `Brief.targetWords`; the leaf
therefore emits counted progress only and a host must not relabel scalar/byte counts as words
or invent a cadence from them. The 037 authoring contracts now define a versioned check-in
cadence policy and pure due evaluator (`CheckinCadencePolicy` in
`packages/core/src/authoring/contracts.ts`, ADR 0019 defaults), and this leaf now emits cadence
when the caller supplies counted progress: an optional `cadence` request input carries
`callerCountedProgress` (adopted chapters/saved words counted by the caller, first-adopted-chapter
and irreversible-choice flags, field names exactly as the authoring contract names them) plus an
optional policy. An omitted policy uses the ADR 0019 default as the documented adapter-level
choice; a supplied malformed policy or progress refuses with the authoring vocabulary preserved
and is never coerced. A supplied cadence emits the evaluator's `{ due, reasons }` verbatim plus
the validated policy snapshot and validated caller-counted progress as `checkin.cadence`, so
`savedWordsSinceCheckin` is caller-counted progress, never a word count derived from campaign
prose. A campaign refusal (stale, partial, cross-book or future) wins and emits no cadence
section, and an omitted cadence input emits no cadence section at all. No check-in scheduling is
derived here; the leaf only evaluates the supplied counted progress.
The desktop host (039 T018 seam 6b) exposes that mapping as one read-only
`continuation:checkin` channel: ids are validated before the Library is touched, the checked
campaign is loaded through the store readers above, and the counted inputs cross the `Result`
envelope with the leaf's refusal codes preserved as typed failures. The 037 run owner and
direction are host-supplied; this build registers no coordinator session in the main process,
so the channel refuses truthfully until one exists rather than inventing an owner. The host does
not yet supply cadence inputs, so the channel emits no cadence section yet. Coordinator
execution, a presenter surface, a portable archive/export workflow and independent review
remain separate work. These leaves and the storage slices have focused synthetic tests, not
independent acceptance or a self-contained archive.

## 1. Encoding and operation limits

Use the existing review-record raw boundary: fatal UTF-8, no BOM, duplicate object keys, lone
surrogates, lossy or non-finite numbers, `-0`, sparse arrays, accessors or non-plain JSON values.
Numbers obey the existing lossless safe-magnitude rule. New bytes are compact canonical JSON, with
object keys ordered by UTF-16 code units, no insignificant whitespace and no trailing newline, using
the repository's `canonicalJson` / `canonicalJsonText` semantics. Other standards' canonicalizers
are not assumed interchangeable. `C(v)` means the exact UTF-8 bytes of that canonical JSON value;
`H(x)` is lowercase SHA-256 of bytes `x`. Counts are nonnegative safe integers unless a positive
minimum is specified, and every sum uses checked safe-integer arithmetic. Spans are nonempty,
half-open UTF-16 code-unit offsets with scalar-safe endpoints; selected text sizes are UTF-8 bytes.

All applicable ceilings intersect; unknown fields, escaping, punctuation, headers and IDs count.
These are conservative per-operation policy ceilings, not storage quotas, performance measurements,
or permission to prune or truncate. Refuse before over-budget allocation and preserve all drafts and
files. They do not raise legacy schema-1 or ordinary request limits.

| Limit | Exact scope |
| --- | --- |
| 2,500,000 bytes | Every manifest, segment, intent or other document, including unknown fields. |
| 262,144 bytes | Complete active candidate manifest, including unknown fields. |
| 2,000,000 bytes | Each exact serialized segment document, including header, tokens, ID and unknown fields. |
| 1,900,000 bytes | `C(token).length` for any one token, including its wrapper and JSON escaping. Refuse an oversized value or key; do not split a scalar or trim it. |
| 64 segments, 33,554,432 segment bytes, 1,000,000 tokens | Combined across both active plan and checkpoint streams. Segment bytes sum exact referenced segment file lengths. Apply all three limits together. |
| 134,217,728 bytes each | Separately, `C(plan content without digest).length` and the sum of `C(resolved hole value).length` over **all occurrences**. Count a repeated value repeatedly and stop before either expansion exceeds its limit. |
| 134,217,728 bytes total; 33,554,432 bytes per file | Distinct raw input files loaded for a replan, including selected chapter files and author-selected 032 history files. Count both when both are read. These are read-operation caps, not storage quotas. |
| 1,048,576 bytes | Each complete publication or group-move intent, including unknown fields. |
| 65,536 entries, 1,073,741,824 file bytes, 16,777,216 inventory bytes | One campaign group move's full preflight/verification, including all files and directories, older intents and orphans. Inventory bytes sum the exact `C(inventory)` lengths of the two directory lists in §7, including escaping and punctuation; enforce this budget before unbounded accumulation or sorting. Each file read by this operation is at most 2,500,000 bytes. |
| 64 | Maximum raw JSON nesting and reconstructed token-tree depth. |

Unsupported, oversize, future or unreadable required material must not be skipped to make an
operation fit. Return a named size/availability refusal, retaining the draft and files; a later
larger-cap/streaming workflow needs its own design. The per-document bound applies to serialized
files, not the virtual plan. Do not pass a plan over 2,500,000 bytes as one document to
`encodeCanonicalJson` or `decodeStrictJsonBytes`: compute canonical plan bytes and digest
incrementally, or otherwise measure and bound expansion before allocation, preserving the exact
specified canonical bytes.

## 2. Layout and compatibility

All paths are Library-relative and validated segment by segment. `<campaignId>` follows existing
portable record ID rules and the planner's 160-character maximum. `<operationId>` is a generated,
portable, non-reused opaque record ID of at most 160 characters. Never open an arbitrary path
supplied by a record.

| Path relative to `books/<ownerBookId>/reviews/` | Kind, version and purpose |
| --- | --- |
| `campaigns/<campaignId>.json` | Checked active `review-campaign`, schema 2. |
| `campaigns/<campaignId>.segments/<segmentId>.json` | Immutable `review-campaign-segment`, schema 1. |
| `campaigns/<campaignId>.intents/<operationId>.json` | Immutable `review-campaign-publication-intent`, schema 1. |
| `campaign-moves/<operationId>.json` | Immutable `review-campaign-group-intent`, schema 1, separately retained for recovery. |
| `fixed-history-moves/<operationId>.json` | Immutable `review-campaign-fixed-history-intent`, schema 1, separately retained for recovery (§7.4). |
| `../history/<chapterId>/<file>.md` (i.e. `books/<ownerBookId>/history/`) | Preserved 032 history tree moved with the fixed-history group (§7.4); its own 032 contract governs each record. |

An old schema-1 reader must refuse a schema-2 `review-campaign`, not interpret it as schema 1. A
new version-dispatching reader keeps schema 1 readable under its own rules, with no silent conversion.
Schema-1's projection cannot be reversed into a lossless plan: migration needs independently supplied
originals and a new validated planner result, otherwise it remains inspectable legacy data. No
downgrade, schema-2-as-schema-1 reinterpretation or hidden schema-1 extension-field encoding is
permitted. Segment and intent versions are independent namespaces, not campaign schema 1.

## 3. Manifest and immutable segments

### 3.1 `review-campaign` schema 2

All fields below are required; there are no implicit defaults. Timestamps are UTC ISO 8601 with
exactly milliseconds. IDs are validated as in §2; hashes are lowercase SHA-256.

| Field | Contract |
| --- | --- |
| `schemaVersion`, `kind` | `2`, `"review-campaign"`. |
| `owner`, `id` | `owner` is `{bookId}`, equal to the actual owner folder and the plan's `ownerBookId`; `id` equals the path stem and plan `campaignId`. |
| `revision`, `base` | Positive revision. Revision 1 has `{kind:"absent",revision:0}`. Later revisions have `{kind:"sha256",value:<previous exact raw manifest hash>,revision:revision-1}`. |
| `createdAt`, `updatedAt` | UTC millisecond timestamps, `createdAt <= updatedAt`; creation time remains unchanged on update. |
| `publicationId` | Operation ID selected before building the candidate; also the publication-intent ID. It is not derived from the manifest hash. |
| `plannerSemantics` | Closed value `"review-campaign-planner-v1"`, naming the frozen accepted planner behavior and canonical digest algorithm. Implementing and maintaining this compatibility identifier remains new work. |
| `planDigest` | Existing `CampaignPlan.digest`, `H(C(plan content without digest))`; a consistency digest, not an authentication signature. |
| `plan` | Required stream descriptor below; its reconstructed root is the complete plan content without `digest`. |
| `checkpoint` | `null` or a stream descriptor for the root in §5. Null means no checkpoint was saved, not proof that work was or was not completed. |
| `counts` | `{sources,selectedSpans,stages,rangeStages,synthesisStages,dependencyEdges,selectedUtf16,selectedUtf8,resolvedPlanBytes,holes}`, recomputed from the complete resolved plan. |
| `plannedUnionDigest` | `H(C(U))` for the exact per-source union `U` in §6. |
| `segmentCount`, `segmentBytes`, `tokenCount` | Exact combined referenced document count, raw file byte sum and token count across both descriptors; all limits apply. |

Each stream descriptor is `{stream,tokenCount,segmentBytes,contentDigest,segments}`: `stream` is
`"plan"` or `"checkpoint"`; counts and bytes cover that stream; `segments` is a nonempty ordered
array of at most 64 references. Plan `contentDigest` equals `planDigest`; checkpoint `contentDigest`
is `H(C(checkpoint root))`. Each reference is `{sequence,firstToken,tokenCount,id,revision,bytes,sha256}`:
zero-based contiguous `sequence` and token offset, positive token count, segment ID, immutable
`revision:1`, exact raw file length and `H(exact raw file bytes)`. No duplicate ID/reference,
overlap or gap is allowed across the manifest. Descriptor sums must equal manifest totals.

For `counts`, `sources` and `stages` are array lengths; `selectedSpans` counts normalized selected
source segments; `rangeStages` and `synthesisStages` partition stages; `dependencyEdges` sums
dependency-array lengths; `selectedUtf16` sums selected union lengths; `selectedUtf8` sums the UTF-8
text bytes once per selected source segment, not once per envelope occurrence; `resolvedPlanBytes` is
`C(plan content without digest).length`; and `holes` counts all plan hole occurrences, including
repetitions. The manifest has no status spelling that proves completion; any UI label derived from
validated checkpoint facts identifies them as host-reported. Coverage, execution, currentness, evidence
and synthesis are distinct. No prompt, body, report or provider wire payload is embedded in a known
manifest field.

### 3.2 `review-campaign-segment` schema 1

Each segment is
`{schemaVersion:1,kind:"review-campaign-segment",owner:{bookId},campaignId,planDigest,stream,revision:1,sequence,firstToken,tokens,id}`.
Owner, campaign ID and plan digest equal the referencing manifest. Stream, sequence, first token and
token count equal the reference; `tokens` is nonempty. The ID is `"s-" + H(C(body))`, where `body`
contains **all** segment members except `id`, including supported unknown members. The file stem
equals the ID. The reference raw SHA-256 covers the entire exact file **including** `id`; its input is
different from the semantic ID's input. Reformatting a segment changes the raw hash and is a mismatch
even if its semantic ID is unchanged.

Pack canonical tokens in stream order as the largest contiguous prefix whose **complete canonical
segment document** fits 2,000,000 bytes, then continue. Also enforce token, manifest and aggregate
limits. The ID hash width is fixed; compute and recheck final bytes instead of trusting an overhead
estimate. Refuse a token that cannot fit with its actual header. A byte-identical canonical segment
with the same owner, campaign, plan, stream, sequence and offset may be reused after verification.
A different file at that ID, even if semantically similar, is a conflict/uncertain state, never
overwritten. Retain old segments and intents; there is no implied garbage collection.

## 4. Token grammar and external holes

Tokenize the plan root without `digest` recursively in sorted-key order, preserving array order. The
checkpoint uses the same grammar but **no holes**. Each token is a JSON object:

| Token | Meaning |
| --- | --- |
| `{t:"O"}`, `{t:"}"}` | Start/end object; keys inside must be unique and strictly increasing. |
| `{t:"K",value:<string>}` | Object key; exactly one complete value follows. |
| `{t:"A"}`, `{t:"]"}` | Start/end dense array. |
| `{t:"V",value:<null/boolean/number/string>}` | One primitive; object or array values are not permitted in `V`. |
| `{t:"H",kind,bytes,digest}` | One entire external value at an allowlisted plan path; `bytes=C(value).length`, `digest=H(C(value))`. |

The parser carries its logical object/array path across segments. Reject wrong closures, duplicate or
out-of-order keys, trailing values, invalid structure and depth/count overflow. Never derive executable
code, path lookup, prototype mutation or dynamic dispatch from a token. Data keys, including
`__proto__`, are ordinary own keys. Unknown tags or closed-union values are unsupported, never
discarded. These JSON Pointer patterns are exhaustive (`i`, `j`, `k` denote array indices); each
required location contains only its matching hole, and no other location may contain a hole:

| Plan path | `kind` and exact external value |
| --- | --- |
| `/sources/{i}/segments/{j}/text` | `source-text`: the exact selected source-segment string. |
| `/stages/{i}/envelope/sources/{j}/segments/{k}/text` | `source-text`: the exact range/boundary or synthesis-evidence string disclosed in that envelope. |
| `/stages/{i}/envelope/prompt` | `stage-prompt`: the exact complete generated stage prompt string, not merely the original base prompt. |
| `/stages/{i}/envelope/priorFeedback` | `prior-feedback`: the entire ordered feedback array, including IDs, run IDs, labels and text; synthesis reservations include their NUL placeholders. |

The parser derives the logical path; do not trust a supplied pointer. Resolve the exact JSON type,
then compare canonical UTF-8 length and digest **before** insertion. A missing value is
`external-unavailable`; a wrong type, hash or length is `external-mismatch`. A resolver may recompute
a stage prompt or placeholder from independently supplied exact input, but it must match its hole
and the whole-plan digest. There is no unredacted fallback or guessed placeholder. Hashes and lengths
are consistency checks, not secrecy, origin authentication or consent; low-entropy strings can be
guessed from hashes.

Non-hole fields retain full profile name/purpose/guidance, book and chapter titles, destination
`provider`, `model`, opaque `endpointIdentity`, environment, tool/consent revisions, policy and
attribution. They and unknown fields may be sensitive. The current planner requires only a nonempty
endpoint identity and does not prove it safe to retain. Before explicit Save, the host must disclose
retained metadata and establish that this identity is non-secret and opaque, **not any endpoint URL
or credential**; otherwise refuse without rewriting the plan. Do not knowingly save credentials or
raw provider payloads in other metadata. Four hole paths are not encryption, general redaction or a
data-loss-prevention system.

## 5. Checkpoints and unknown data

The checkpoint stream root is
`{checkpointVersion:1,owner:{bookId},campaignId,planDigest,capturedAt,stages:[...]}`. Owner,
campaign and plan digest bind the manifest; `capturedAt` is a UTC millisecond timestamp. `stages`
contains **exactly one entry for each plan stage in plan order**, even if no host fact is available:
`{stageId,receipt:null | {status,completedCategories,at,actualScopeDigest,report}}`.

- `stageId` equals the stage at that ordinal; no duplicates or foreign IDs.
- `status` is `planned`, `running`, `completed`, `incomplete`, `failed` or `stopped`.
  `completedCategories` is the exact ordered, duplicate-free subset of plan categories supplied by
  the host and is empty unless status is `completed`. Completion need not claim every category.
  `at` is a UTC millisecond timestamp or `null`.
- `actualScopeDigest` is a lowercase SHA-256 or `null`, describing only a separately admitted actual
  envelope. Never copy a synthesis reservation's scope digest into this field as actual. This format
  does not store the actual summaries.
- `report` is `null` or `{ownerBookId,runId,sha256}` for an independently and explicitly saved,
  immutable schema-1 report at that owner's ordinary path. `runId` equals the planned envelope's
  request/stage ID; `sha256` hashes its exact raw file. If present, `actualScopeDigest` must equal the
  report's disclosure scope digest; check report identity/profile, applicable envelope attribution
  and that the owner is a participating book in the report. Do not reference one report twice in a
  checkpoint. Missing, foreign, changed, unsupported or unresolvable references remain represented as
  unavailable, not silently removed.

`report:null` is legal even for a host-reported completed stage; this does not change schema-1's
stricter completed-stage rule. Neither a status nor report hash proves execution, consent, verified
synthesis evidence or currentness. Do not automatically create/trash reports or dispositions when a
checkpoint changes. 037 owns authenticated receipts, attempts, summaries, permissions, budgets and
retry policy; if an actual summary needed to resume synthesis is unavailable, stop rather than infer it.

A schema-1 report is owned by a book participating in its own stage, so multi-book range stages
can need a different report owner than the campaign owner. The checked store now provides that
separately authorized cross-book read/identity seam (`resolveContinuationReports`): each reference
is read only from its recorded owner's ordinary path and verified by raw hash, record identity
and disclosure scope, the recorded owner wins, a verified foreign report is reported as a bounded
foreign reference, and a missing, foreign, changed, unsupported or unresolvable reference remains
represented as unavailable in stage order, never silently adopted, merged or dropped, and never
claimed as saved-report completeness. Independent review remains required. No cross-book
mutation, multi-book transaction or automatic report creation is authorized.

### Unknown and future data

Supported unknown plain JSON fields survive at every loose level, including nested checkpoint entries
and own `__proto__` fields. Manifest, `counts`, segment, intent, checkpoint root, checkpoint stage
entries and non-null receipts are loose. `owner`, `base`/`expectedBase`, stream descriptor, segment
reference, token, checkpoint report reference, publication `candidate`, group component and inventory
entry objects are closed controls: an unknown member is unsupported, never dropped and rewritten.
Unknown fields grant no authority and count toward all limits. Supported unknown segment fields
participate in its semantic ID; the entire exact original segment file participates in its raw hash.

On checkpoint read-modify-write carry supported unknown root, stage and receipt fields into the
corresponding new stream. On manifest update carry supported unknowns without overwriting an explicit
new known value with a stale unknown. If a resegmented segment's unknown field cannot be mapped and
preserved without changing its meaning, refuse the rewrite and retain old bytes and draft. A future
schema/semantics version, unknown token tag, unsupported category/status/source kind, unknown field
inside a closed planner-contract object, or malformed/lossy value is `newer-schema`, `unsupported`
or `corrupt` as appropriate: inspect without rewrite and offer an updated reader. The v1 planner
parses strict shapes; do not silently discard hypothetical future plan members to match an older plan.

## 6. Mapping, integrity and planner provenance

The token stream retains all plan content, not a curated projection: operation and ownership;
taxonomy, ordered categories and the entire immutable profile; ordered source IDs, kinds, identities
`{bookId,chapterId,version,hash}`, titles, position, capture time, body UTF-16 length and normalized
selected `{start,end,startLine,text}` segments; exact `maxPrimaryScalars`, `boundaryScalars` and
`synthesis:null` or `{fanIn,summaryBytes,evidence:[{sourceId,ranges}]}` policy including original
evidence-range spelling and order; stage IDs/kinds/dependencies/origins, primary and boundary ranges;
and complete envelope source inventories, profile, participating book/consent/tool facts,
environment/destination, scope digest, admission and neutral serialized bytes, with only §4's values
externalized. The original top-level request and original input-range spelling beyond the normalized
plan are not promised.

Keep synthesis policy evidence windows and the synthesis envelope's normalized original-source
window inventory separate from recursive dependency-derived `origins`. Synthesis `primary` and
`boundary` are empty; derived feedback is not a verified original quotation. Range stages carry their
admitted envelopes; synthesis stages carry worst-case U+0000 summary **reservations**, not dispatchable
actual inputs. Boundary context and synthesis attribution do not earn primary coverage. Preserve the
exact historical planner `persistence {status,reasons,projectedBytes}` including `non-persistable`;
it is neither this format's save result nor an instruction to use schema 1.

Define `U` exactly as
`{ownerBookId,taxonomyVersion,categories,profile:{id,version,digest},sources:[{sourceId,identity,planned}]}`.
Sources follow plan order; `planned` is each source's sorted selected half-open union, merging overlap
and adjacency only, never gaps. `C` supplies canonical key order. Recompute `U` from selected sources
and independently from every **range-stage origin.primary**, grouped by matching source ID and exact
identity; both forms and `H(C(U))` must match the manifest. Count ranges and UTF-16 lengths with
checked arithmetic; check `selectedUtf8` only after text resolution. Coverage is per source identity,
category, taxonomy and profile; a total or byte count is not a union proof.

On the fully resolved plan also require unique source IDs and book/chapter identities, valid scalar-
safe text/line/range relationships, exact book/title membership and per-stage source identities. Each
range boundary lies within the same selected contiguous segment and does not earn primary coverage.
Stage IDs are unique; dependencies exist, are unique where required by the planner, and precede their
dependent in plan order. Refuse missing, foreign, self-referential, cyclic or misordered dependencies,
including across segments. Recursively check synthesis origins against dependencies and its global
evidence-window disclosure against policy. Revalidate profile digest, envelope scope digests, neutral
request serialization/byte admission and all counts. Coverage arithmetic does not verify quotations
or establish exhaustive detection (`evidence:"not-assessed"`).

### Staged reading and trusted use

A pure encoder accepts only locally provenanced plans through the existing `requireCampaignPlan`
gate. Deserialized content does not satisfy that gate merely because a digest matches.

1. Open exact manifest bytes under the expected owner/path; enforce raw, schema, size and checked base
   shape. Validate reference type/count and derived path before traversal.
2. Read each reference in order under its byte cap. Verify raw length/hash, strict JSON, semantic ID,
   owner/campaign/plan/stream/revision, sequence, offset and token count. Enforce cumulative limits
   before allocation; refuse missing, duplicate, foreign, reordered, tampered, extra/gapped or
   unsupported referenced data. Unreferenced files are retained recovery material, not active data.
3. Parse tokens and verify stream totals. A result with holes is **structurally inspectable only**,
   not a validated plan or complete coverage. Resolve every allowed hole within both expansion
   budgets; recompute plan digest, envelope digests, counts, unions and checkpoint content digest.
   Missing originals are unavailable; wrong originals mismatch. Never substitute current prose or
   invented feedback.
4. Use a current chapter only after unique resolution and hashing of its **raw chapter file**,
   validation of book/chapter/version/hash, canonical body, full-body length, line maps, scalar
   endpoints and selected hole values. An explicitly author-selected valid 032 history record may
   supply a historical body only after identity, `sourceVersion`, `sourceHash`, `bodyHash`, record
   validity and hole values are checked. Historical `sourceHash` is metadata, not a fresh hash of
   unavailable old chapter-file bytes or authenticated origin. Body equality alone does not prove raw
   source identity. Replanning needs full bodies in memory even when disclosure later selects less.
5. **Digest equality is not planner provenance.** To use planner-only APIs, construct a valid input
   from independently validated full bodies, exact supplied base prompt/prior feedback, explicit
   policy/profile/categories/disclosure facts and normalized selected spans. Invoke the frozen
   compatible planner and compare **complete canonical plan content and digest**, including scope
   digests, reservation placeholders and persistence projection. Use only its locally registered
   returned plan; do not register a deserialized object in the existing process-local WeakSet based on
   a hash. A base prompt may be recovered from a stage prompt only by consistently checking/removing
   that planner version's exact generated suffix for every stage. Original request book order may not
   be fully retained when books never co-occur: derive a consistent candidate from retained envelope
   subsequences and require complete comparison, not a claim of recovering original order. Missing
   inputs, unavailable compatible behavior or unequal content means unavailable/unsupported. A
   separately specified and independently reviewed equivalent validator could replace replan later.

Future planner changes can alter `persistence` or serialization and prevent an otherwise similar
replan from matching. `plannerSemantics` requires preserved compatible behavior or an explicit future
migration decision; it is not a claim that the needed registry exists or that every retained plan is
replannable from incomplete inputs.

## 7. Publication, recovery and group operations

### 7.1 Publication intent and checked publication

The immutable intent is
`{schemaVersion:1,kind:"review-campaign-publication-intent",owner:{bookId},id:operationId,revision:1,campaignId,createdAt,expectedBase,candidate:{encoding:"base64",bytes,sha256,data}}`.
`createdAt` is a UTC millisecond timestamp; `expectedBase` exactly equals the candidate manifest's
`base`. `candidate.bytes` is the exact raw manifest byte length and `candidate.sha256` its raw
SHA-256. `candidate.data` is standard RFC 4648 padded base64 of the **exact canonical candidate
manifest raw bytes**, with no whitespace. Decode strictly and verify length, raw SHA-256, strict
schema, owner, campaign, publication ID, base and all manifest bounds. At the manifest cap its base64
payload is at most 349,528 ASCII bytes; still enforce the complete intent bound. The intent contains
no segment bytes or inverse segment pointer and is never edited to mark a phase.

Production publication requires explicit author Save, a locally validated complete plan, verified
holes, a bounded encoded/read-back candidate, supported preserved unknowns, permitted report
references and an adapter with the proven write/exclusion capability below. Use the Library service's
book queue and journal-aware writer, never direct adapter commits.

1. Snapshot the prior exact manifest bytes/hash/revision or verified absence. Build all candidate
   segments, references, manifest and intent within bounds; reparse/validate and independently compute
   identities before publication. Preserve the draft on every refusal. A changed plan gets a new
   immutable plan stream/digest; a checkpoint-only revision reuses exactly matching plan segments.
2. Absent-only commit the intent and verify exact readback/hash. Stop on uncertainty, before segments.
   The intent contains the desired manifest, not missing segment contents; interruption may leave an
   irrecoverably incomplete draft if exact segment bytes/originals cannot be recreated.
3. Publish new immutable segments absent-only in deterministic stream/sequence order and verify exact
   readback/hash. Reuse existing byte-identical files only after identity checks. Unequal bytes or
   unexpected publication conflict; uncertain results stop. Leave written material in place.
4. Re-read every intended reference and validate aggregate reconstruction, expected current manifest
   and applicable reports. Commit the manifest **last** against absence or exact prior raw hash and
   revision. Verify complete manifest bytes/hash, then references again. Report `published` only after
   these checks; readers validate references again on open.
5. A stale/missing prepublication base is a conflict. Preserve intended candidate/intent and, where
   supported, an inactive conflict copy under existing policy; never overwrite the newer active file.
   If copy metadata cannot fit or be confirmed, report `not-kept`/`uncertain`, retain the in-memory
   draft and name an intent only if it was actually verified. A disk-full/readback failure is not success.

The manifest is a publication pointer, **not** a multi-file transaction. Preflight plus readback
does not exclude an independent writer, and the per-book queue or a file expectation alone does not
prove atomic CAS. Checked mutation requires either independently conformance-tested atomic
absent/hash conditional commit across competing writers **and** safe immutable-file creation, or a
separately proven exclusive-writer facility covering those writers. Otherwise expose inspection and
an honest `unsupported-concurrent-writer` save refusal. No power-loss durability beyond the adapter's
proven contract is claimed. Adapter conformance and a usable writer remain required work.

### 7.2 Explicit recovery; no automatic replay

List intents and inspect the active manifest, raw hash and every candidate reference without writing.
Classify each intent as follows:

| Observed state | Result and permitted explicit next step |
| --- | --- |
| Active manifest exactly equals candidate; referenced raw hashes, identities, order and descriptor totals verify, as does any checkpoint digest | `already-published` is only a byte/pointer observation. Holes may be unavailable; do not claim plan digest, union, coverage or continuability until full resolution and provenance checks pass. Do not commit again. |
| Expected base remains exact, all candidate segment bytes verify, candidate and holes validate | `prepared`; the author may explicitly request one new checked publication attempt after fresh revalidation. No background retry. |
| Expected base remains, but some references are absent | `incomplete-draft`; author may explicitly provide/recreate exact missing bytes and originals, checked against retained references before absent-only write. Otherwise remain unavailable. |
| Another manifest/revision, unequal bytes at an ID or lost prior base | `conflict`; retain intent, segments and draft; show both identities. Only an explicit newly validated rebase/new intent can proceed; no overwrite, merge or provenance inference from prose equality. |
| Post-publication uncertainty, readback/hash mismatch, unsupported or changing file | `uncertain`/`unavailable`; inspect both locations and all references, then stop. No blind replay, repair, deletion or success label. |

Explicit retry still needs current capability, expected base, source/consent and other relevant gates;
it is not retry of a provider request. Recovery never automatically creates history, fetches a provider,
derives feedback, runs synthesis or resolves a report. Retained intents can be abandoned/conflicting
and do not themselves prove publication.

### 7.3 Campaign group move, trash/restore and archive

The campaign group is its active manifest and the **entire** campaign-specific segment and
publication-intent directories, including unreferenced older/partial files. Independently owned
reports, dispositions, profiles and book-level conflict copies are not swept up merely by reference.
Group-move intents in `reviews/campaign-moves/` remain separately retained and included in ordinary
whole-book archive/sync. Never automatically delete an old group, intent, conflict or orphan.

A capability-gated operation moves exactly three fixed components: manifest file, whole segment
directory and whole publication-intent directory. It needs a journal-aware `moveDirectory` Library
host seam and adapter conformance for same-filesystem atomic directory move; `moveFile` handles the
manifest. Each move additionally requires conformance-tested atomic **no-replace** destination or
proven exclusion covering every competing source/destination writer for the whole operation. Atomic
rename alone is not proof of no-replace. Without source-side exclusion, source changes can still occur;
a failed post-move inventory is uncertain and must stop. Current interfaces do not establish these
guarantees. No copy fallback is atomic. Refuse before the first move if capability, bound, identity
or collision preflight fails; a segmented file-by-file ledger needs separate design.

Before the first move, absent-only write/read back this immutable intent:
`{schemaVersion:1,kind:"review-campaign-group-intent",owner:{bookId},id:operationId,revision:1,campaignId,action:"trash"|"restore",groupId,createdAt,components:[...]}`.
`createdAt` is a UTC millisecond timestamp. Exactly three ordered descriptors name `segments`,
`publication-intents`, `manifest`, each `{name,type,sourceLocation,destinationLocation,entries,bytes,inventoryDigest}`.
Locations are closed symbolic `"active"` or `"trash"`, never arbitrary paths; source/destination are
opposite and match the action. `groupId` is generated, portable, non-reused and opaque, at most 160
characters. Restore uses the original trash group ID and a new operation ID. Resolve `active` to
`books/<ownerBookId>/reviews/` and `trash` to `.studio/trash/<ownerBookId>/reviews/campaign-<groupId>/`;
append the same validated `campaigns/<campaignId>.segments`, `campaigns/<campaignId>.intents` or
`campaigns/<campaignId>.json` suffix. Refuse existing destinations or mismatched group identity.

For the manifest, `type` is `"file"`, `entries` is 1, `bytes` is its exact raw length and
`inventoryDigest` is its raw SHA-256. For the two `"directory"` components, `inventoryDigest` is
`H(C(inventory))`. The inventory contains the root `{path:[],type:"directory"}` and every descendant
as `{path:[<relative components>],type:"directory"}` or
`{path:[<relative components>],type:"file",bytes,sha256}` with exact raw file hash. Validate path
components without following links; sort component-by-component in UTF-16 code-unit order, prefix
before descendants. Component `entries` is inventory length and `bytes` the checked sum of file
lengths, not an inline list. Include empty directories; refuse unsupported entries/symlinks without
following them. Apply §1 scan bounds across all three components, including both roots. The intent
records expected inventory, not a transaction or authenticated origin.

Preflight all three inventories and all destination absences. Move segments and intents first, then
manifest last, verifying location/inventory and journaling after each. Restore uses inverse locations
and the same order; all active destinations must be absent. Partial trash can leave an active manifest
with moved segments; readers show missing/partial, not complete. Partial restore can leave inactive
files at both locations. On error, race or uncertainty stop and retain both locations and the intent;
explicit recovery inspection compares both sides to recorded inventories before a fresh checked action.
Do not label a post-move failure a preflight refusal, automatically roll back, overwrite or silently
mark restored. External races need capability/exclusion and post-move verification; otherwise refuse
or report uncertain.

Archive/export is a separately authorized copy/publication workflow, not a move. Include all ordinary
campaign files, recovery intents and independently owned reports/dispositions in the selected archive
scope, including supported unknown bytes. Verify exact bytes and completeness under that workflow's
own limits; refuse overflow or unreadable required data rather than omit it. The checked store
implements the trash/restore move and its `active`/`archived`/`partial`/`absent` inspection above
without claiming the separately authorized archive/export workflow, cross-writer atomicity beyond
the adapters' proven no-replace moves, or independent acceptance.

### 7.4 Fixed-history group move, trash/restore

The fixed-history group is the preserved history sidecar set belonging to a book's
continuation: the owner book's entire 032 chapter-history tree (`books/<ownerBookId>/history/`,
every `<chapterId>/` record file) together with the campaign's active manifest and entire
segment and publication-intent directories. It is book-scoped in its history component and
campaign-scoped in its other three; independently owned reports, dispositions, profiles and
book-level conflict copies are still not swept up. Fixed-history move intents in
`reviews/fixed-history-moves/` remain separately retained. Never automatically delete an old
group, intent, conflict or orphan.

This operation differs from §7.3 in membership, ordering and dispatch, and otherwise keeps
§7.3's guarantees. Membership is four fixed components, not three: `history`,
`segments`, `publication-intents`, `manifest`. Ordering is history first, then segments and
publication-intents, then manifest last, so the manifest-last guarantee is preserved.
Dispatch is two-level: the manifest dispatches on recorded schema/`plannerSemantics`
exactly as §7.3 (current label movable, compatibly differing label movable only through a
local normalized comparison copy with stored bytes never altered, future or unknown labels
refused before any move), and every history record additionally dispatches on its own
032 contract — schema 1 `snapshot`/`safety`/`intent` naming the caller owner and its
directory chapter with a verifying `bodyHash` is movable byte-identically; a future schema,
unknown kind, foreign identity or divergent body refuses before any move. History bytes are
inspected, never re-encoded.

Before the first move, absent-only write/read back this immutable intent:
`{schemaVersion:1,kind:"review-campaign-fixed-history-intent",owner:{bookId},id:operationId,revision:1,campaignId,action:"trash"|"restore",groupId,createdAt,components:[...]}`.
Exactly four ordered descriptors name `history`, `segments`, `publication-intents`,
`manifest`, each `{name,type,sourceLocation,destinationLocation,entries,bytes,inventoryDigest}`
with the same closed symbolic `active`/`trash` locations and opposite source/destination
rule as §7.3. Resolve `active` history to `books/<ownerBookId>/history/` and `trash` history
to `.studio/trash/<ownerBookId>/reviews/campaign-<groupId>/history/`; resolve the other
three components exactly as §7.3. `groupId`, `operationId`, inventories, digests and §1 scan
bounds (65,536 entries, 1,073,741,824 file bytes, 16,777,216 inventory bytes, 2,500,000 bytes
per file, applied across all four components) follow §7.3, including unsupported-entry
refusal without following links. The intent bounds at 1,048,576 bytes including unknowns.

Preflight all four inventories, full wire verification and per-record history dispatch at
the source, and all destination absences. Move history, segments and intents first, then
manifest last, verifying location/inventory and journaling after each. Restore uses inverse
locations and the same order. An empty history tree (no record files) is neutral for
inspection: the continuation parts alone decide `active`/`archived`/`absent`, and history
files alone never make a group. Partial trash or restore leaves files at both locations;
inspection classifies `active`/`archived`/`partial`/`absent` and readers never show a
partial group as complete. On error, race or uncertainty stop and retain both locations and
the intent; do not label a post-move failure a preflight refusal, automatically roll back,
overwrite or silently mark restored. The checked store implements this move and inspection
without claiming the separately authorized archive/export workflow, cross-writer atomicity
beyond the adapters' proven no-replace moves, or independent acceptance. Revision chains
and ownership are preserved because retained bytes are moved, never re-encoded.
