# Pure review campaigns (039 T017)

`campaign-planner.ts` and `campaign-coverage.ts` are host-neutral, volatile leaves. They perform
no filesystem, provider, clock, scheduler, device or writer calls. Import them directly; the ordinary
review entry point and ADR 0018 admission limits are unchanged.

## Input and planning

`planReviewCampaign(unknown)` accepts only `operation: "plan-full-book-review"`, an explicit campaign
ID/time/owning book, selected saved chapter bodies/ranges, a validated reader profile, v1 categories,
the existing request disclosure facts, and an explicit policy. The host must already have uniquely
resolved the saved files and validated their raw-file hashes. This leaf checks canonical body equality,
Unicode, saved identity shape, duplicate source IDs/chapter identities, book/title membership, profile
digest/version/semantics, category membership and every selected scalar-safe UTF-16 range. It does not
read or rehash files, infer selection from a library, or certify currentness. V2 categories refuse until
their wire/profile contracts exist; v1 meanings are not repurposed.

Input is checked as plain lossless data and detached before hashing. Output is frozen, and only plans
created here are accepted by the aggregation/admission helpers. Serialized/copied plans must be
replanned from validated inputs; a matching caller-supplied digest is not validation provenance.
The chosen `ownerBookId` is retained in the immutable plan and its digest independently of selected
source ownership or projected record size. Another owner's otherwise identical plan cannot reuse
its coverage receipts or synthesis summaries.

Policy fields:

- `maxPrimaryScalars`: maximum scalars per primary window, within the existing source-byte ceiling.
- `boundaryScalars`: disclosed neighboring scalars on each side **within the same selected contiguous
  range**. Context never enters primary coverage. Separate selected ranges never bridge a gap.
- `synthesis: null`, or explicit `fanIn`, per-dependency `summaryBytes` and original-source `evidence`
  windows. Evidence windows must lie in the selection, and are disclosed in every synthesis request.

Selected overlapping/adjacent ranges union first using existing capture logic. Source/range order is
retained; stage IDs are campaign ID plus deterministic ordinal. Scalar endpoint/line indexes support
request trials. Each trial uses `buildReviewEnvelope` and `serializeProviderRequest`, including real
instructions/tools/response schema, profile, all selected prior feedback, category/primary/context
metadata, source text and JSON escaping. A maximum window is tried first, then binary admission finds
a fitting smaller window. No prose, metadata, prior feedback or findings are clipped. Packing is not
claimed optimal (descriptor lengths can change at boundaries); every accepted window fits and the
next begins at its exact primary endpoint. Failure to fit even a scalar returns a refusal. Scalar
boundaries are not linguistic, sentence, grapheme or semantic-quality boundaries.

Only participating selected books appear in each stage envelope. All original source identities,
raw hashes, revisions and the complete immutable profile survive. Every stage's output remains under
ordinary output/finding/citation bounds; range completion does not imply exhaustive detection.

## Synthesis

Synthesis forms a deterministic fan-in tree with explicit dependencies and original primary-source
attribution, including across intermediate summaries. It contributes **zero primary coverage**.
Selected original evidence windows, profile, prior feedback and attribution overhead are admitted
alongside summaries. Reservation envelopes use `summaryBytes` U+0000 characters per dependency: one
UTF-8 byte with worst-case JSON escaping, including nested serialization. They are marked
`admission: "summary-reservation"` and **must never be dispatched**.

`admitCampaignSynthesis(plan, stageId, summaries)` requires exactly the ordered completed dependency
IDs and exact plan digest, validates scalar text and byte ceilings, substitutes the actual summaries,
and repeats ordinary envelope admission. Oversized/missing/failed inputs refuse, without shortening
them or automatically asking for replacement summaries. These are host-supplied completion facts,
not authenticated provider or execution receipts. The eventual coordinator must prove completion,
authorize each call, and enforce final provider-adapter serialization after wrapping the neutral
request. This module neither generates summaries nor authorizes their generation.

Summaries are labelled derived feedback, never source text or verified citations. The ordinary exact
citation verifier accepts only original text inside the synthesis evidence windows. Attribution to a
larger primary range does not make quotes outside those windows verified. The host must separately
select/admit any further original evidence it needs; no automatic retrieval is provided.

## Coverage

`aggregateCampaignCoverage(plan, receipts, current?)` returns separate source/category coverage,
execution, synthesis, evidence (`not-assessed`) and per-source currency. Coverage keys include exact
book/chapter/version/raw hash, category/taxonomy version and profile ID/version/digest. Completed
categories are explicit; incomplete, failed, stopped or missing stages earn no coverage. Receipts
with the wrong plan, foreign stages, duplicate identities or invalid categories refuse.

Primary interval union never double-counts overlap and subtraction retains all gaps. Synthesis failure
does not erase completed source coverage; synthesis completion with incomplete dependencies remains
incomplete. Freshness facts are optional and host-supplied: absent facts mean `not-checked`, a missing
source is `unavailable`, and a changed revision/hash/identity is `stale`. None of these change historical
completed coverage. Execution facts do not establish verified evidence or literary quality.

## Persistence and retained gates

The plan is **not** a durable campaign record. `persistence.status: "within-current-limits"` means only
that a schema-1 projection passed `buildCampaignRecord` and exact `campaignBytes` serialization. It
does not claim a lossless persistence mapping. That projection intentionally does not invent unknown
extension fields to smuggle category/context/policy semantics through the existing writer.

`non-persistable` retains the **whole** plan and names failed limits. Current records cap sources,
total stages and per-source planned spans at 64, and `plan.sourceBytes` plus exact record serialization
at 2,500,000 bytes. A 120-chapter/250k-word selection therefore needs continuation even though each
request fits. No limit is enlarged, record truncated, or writer invoked.

Before persistence/integration, the format owner must specify and implement:

1. Versioned segmented campaign source/stage continuations with ordered segment references, exact
   hashes/revisions, aggregate counts and coverage integrity, missing/duplicate/foreign/cyclic segment
   refusal, and complete recovery/unknown-field rules. Cross-segment synthesis dependencies must bind
   exact stage and source revisions. Aggregate source-byte totals need representation beyond the
   current single-document `plan.sourceBytes` ceiling when necessary.
2. A lossless supported mapping of taxonomy/categories, profile snapshot, per-source primary versus
   boundary selection, planning policy, synthesis evidence windows and dependency attribution. Current
   stage `planned` is an unqualified span array; it cannot alone preserve this contract.
3. Checked multi-file publication/recovery without claiming partial manifests complete, followed by
   the separately authorized 037 scheduler, budget/consent/current-source gates, provider adapter,
   evidence verifier, Library/API/UI mounting and fresh exact-candidate independent review.

## Complexity and synthetic verification

Let N be selected UTF-16 text, R primary stages, W the policy window (at most the existing source-byte
limit), E serialized request size, and A the total retained attribution. Before strict shape parsing,
plain-data preflight visits each distinct object once, in O(V + P) time and space for V distinct
objects and P own properties/array entries. Active-cycle detection is separate from completed-object
memoization; the memo is local to each synchronous check. Unsupported shared DAGs are rejected
without expanding their paths. Schema parsing still validates/detaches all accepted input before
the first await; Unicode and scalar checks retain their existing text cost. Canonical serialization
and schema cloning cost their expanded output, not the number of distinct caller objects.
Indexing is O(N); admission
is O(R log W · E), plus schema/capture costs for selected ranges. Capturing many disjoint ranges reuses
the existing capture routine, whose line-prefix scans can cost O(N · number of ranges). Synthesis
admission/attribution costs its total serialized reservations and A; fan-in is at least two. Plan
hashing/freezing is linear in retained serialized content. Memory includes O(N) endpoint indexes and
all retained selected/envelope/reservation text and attribution. No provider-fit or host-performance
threshold is inferred from these bounds.

Coverage indexes receipts and completed primary intervals, then sorts/unions per source/category:
O(C · R log R + C · S + D) apart from supplied identity/currency lookups, for C categories, S sources
and D dependency edges; interval subtraction is linear. Outputs remain detached and frozen.

Dedicated tests: `packages/core/tests/review/campaign-{planner,coverage}.test.ts`. They cover scalar,
UTF-8 and JSON-escaping boundaries, exact complete-request and combined-content limits, preserved
ordinary overflow, multi-book identity, category/profile/revision arithmetic, gaps/overlap, 70k/250k
manuscripts, oversized chapters, durable overflow, failed synthesis and zero-I/O spies. These are
automated synthetic contract checks, not provider, semantic-quality, device or release evidence.
