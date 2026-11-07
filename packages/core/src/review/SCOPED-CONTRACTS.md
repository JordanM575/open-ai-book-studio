# Scoped review core contracts (D-193 / ADR 0018)

These leaf modules implement **pure core only** for 037 foreground guidance and 039 subjective
reader findings. `index.ts` remains the independent 034 deterministic report implementation.
Nothing here opens a Library, persists a conversation/report, calls a provider, generates an ID,
reads a clock, or gives a caller permission to send. Imports are leaf-relative until the integration
owner adds package exports.

## APIs

| Module | Public operations |
| --- | --- |
| `contract.ts` | Frozen `REVIEW_LIMITS`, UTF-8/scalar validation, canonical JSON/SHA-256, checked UTF-16 boundaries and immutable types. |
| `sources.ts` | `captureChapterSource`, `captureBibleSource`; generic `verifySavedBodyQuote` and `checkSavedQuoteNavigation`; source/identity schemas. |
| `envelope.ts` | `buildReviewEnvelope`, `validateReviewEnvelope`, transient serialize/parse, `reviewDisclosure`, `serializeProviderRequest`, final-wire `assertCompleteRequestBytes`, `offeredReviewTools`, `checkReviewStart`, `sourceCurrency`. |
| `facade.ts` | `createReviewReadFacade` returns frozen offered names, `execute` and `serializeResult`, backed solely by captured sources. |
| `profiles.ts` | `builtinReaderProfile`, `editReaderProfile`, `validateReaderProfile`; immutable fictional lenses and checked author lineage. |
| `wire-schema.ts` | Closed tool arguments and requested findings/citation schemas. The tolerant evidence-list parser withholds malformed individual citations. |
| `findings.ts` | `verifyReviewCitation`, `buildReaderRun`, `reviewCitationNavigation`, `compareReaderRuns`. |

Builders detach and freeze nested values. Rehydration verifies schema and content digests before
registration; synchronous serializers refuse unchecked copies. Digests are integrity/binding
values, **not signatures or authority tokens**. A host must independently validate every source,
metadata label, destination and consent fact it supplies.

## Source and identity rules

- Supply the canonical saved body and its **whole raw-file** SHA-256/version from the existing saved
  reader. Core cannot recompute a raw-file hash from body text or resolve duplicate library files.
- Capture keeps only selected nonempty ranges, full-body offsets, body length and line mapping.
  Ranges are sorted within a chapter and overlap/adjacency is merged; the resulting scope must be
  disclosed. Each remaining range counts as a source item, as does each selected Bible field.
  Duplicate chapter/field identities are refused: combine chapter ranges before building an envelope.
  Chapter-source order remains author selection order. Empty selection is refused.
- Existing Bible fields are outline, individual story-arc fields, individual character fields, and
  memory text. Stable record IDs, selected-value digest and containing-file hash are required. There
  is no implicit full Bible, book description, SKILLS, prior conversation or new planning-record read.
- Supplied titles/positions/timestamps are explicit display facts. Source aliases are request-local;
  comparisons across runs ignore alias/capture-time changes but still compare identities, selected
  content, coordinates, labels and revisions. Within a request aliases must match exactly.
- Quotes use nonempty half-open **UTF-16** ranges, exact literal text, valid Unicode and matching
  identity/version/hash. There is no normalization or fallback search. Generic saved-body anchors
  have no 039-specific quote limit; 039 citations enforce 500 Unicode scalars.

## Envelope and wire boundary

037 uses `kind: "guided-review"` with no reader profile; 039 uses `kind: "reader-review"` with a
validated complete profile. The host supplies a fresh request ID per explicit action. A 039 run ID is
that request ID; the output must echo it and the exact profile ID/version on every finding.

The digest includes contract version, request identity, destination/endpoint identity, capability and
disclosure facts, each book's consent/terms/tool facts, prompt, ordered selected sources, complete
profile and explicit prior feedback. `reviewDisclosure` exposes the same envelope encoded in the
provider-neutral request's user-data message. Only constant policy occupies the system message.
Tool descriptions and generated JSON schemas are included in the measured request. These names
match the existing six read tools but the argument schemas are explicitly scoped, not adapters to
the unrestricted Library tools. Search is literal within individual selected segments, reports a
caller-selected 1–100 result cap, and never bridges unselected gaps. A tool must be enabled in every
participating book; Bible reads are absent unless a Bible field was selected.

The 131,072 content-byte budget sums source text, prompt, profile name/purpose/guidance/focus values
and selected feedback text. Labels, structural JSON/escaping, IDs and trusted schemas also count in
the separate 262,144 complete-request budget. No bound silently clips content. Invalid scalar text
is rejected. Unknown price/context remain explicit null/unknown facts, not zero or a fit estimate.

`checkReviewStart` reports invalidation reasons against freshly supplied facts and uniquely resolved
source snapshots. Empty reasons means only **no mismatch in those inputs**; it never authorizes a
send or consumes an action. Cancel returns `not-started`. Revoked/changed consent, missing/ambiguous
or changed sources, changed endpoint/model/capability/price/tool/host facts, changed profiles and
wrong request/digest require a new disclosure. Current sources may have a new capture timestamp.

## Findings and navigation

Invalid top-level output, duplicate finding IDs, wrong run/profile attribution and exceeded byte,
finding, evidence-count, interpretation-scalar or quote-scalar bounds fail the run. No repair call is
made. Invalid individual citation shapes/ranges/revisions/quotes are withheld and counted by index
and reason. Valid citations are labelled `verified-captured`, never implicitly current. Every
interpretation is subjective. A continuity contradiction requires two distinct valid references;
otherwise its derived state is insufficient evidence. Empty-evidence observations are also
insufficient, and mixed valid/invalid evidence is incomplete.

Navigation requires a current uniquely resolved source and the destination editor's same clean
saved identity. Stale/unavailable results retain historical evidence but are never ready to select.
Bible evidence supports a captured-text label; no current Bible editor navigation is claimed.
Run comparison separates source/profile/destination/prompt-feedback changes from changed
interpretation text. Unchanged input plus changed interpretation is model variation, not improvement.

## Integration prerequisites

1. Add coordinated package exports, validated IPC and source-resolution adapters. Refuse unsupported
   hosts **before** private source preparation. Resolve actual saved identities under existing
   Library duplicate-ID rules; explicit metadata must not smuggle unselected prose.
2. Render the exact merged envelope and provider/model/terms/cost/context disclosure. Existing
   011/022 services remain the authority for per-book consent and capability facts. Re-read those
   facts and sources immediately before the explicit provider-named action; close the async race
   to dispatch in the owning runtime. Recheck after awaits and stop/revoke events.
3. Integrate with the existing runtime lifecycle using only the snapshot facade; prohibit ordinary
   prompt/history/SKILLS construction, plugin loading and unrestricted tool dispatch. Final adapter
   wrapping/schema additions **and subsequent tool-result requests** need the complete wire-byte
   check. Bound streaming output bytes before accumulating; core validates a completed string only.
   The browser currently stubs Zod JSON-schema emission (D-188); a browser review host needs its own
   accepted serialization/support integration before it can enable this path.
4. Enforce single-use actions, new IDs on rerun, cancellation, no automatic repair/retry/fallback,
   foreground-only behavior and actual provider attribution in the runtime. These are not supplied
   by a pure equality check or an in-memory checksum.
5. Before durable 037 parts: expected-hash thread writes, conflict preservation, recoverable deletion,
   versioned parts, safe legacy reads and future-version refusal. This prerequisite applies **only
   to 037 conversational retention**. 039 snapshots, profiles and results remain volatile with zero
   ThreadStore writes pending D-171/U-039-03; volatile 039 integration does **not** wait for 037
   persistence. Its runtime tests must spy on every thread/report writer during start, finish, stop
   and failure. Never automatically replay stored 037 review sources in an ordinary prompt.
6. Independently verify exact-candidate UI/runtime journeys, clean-editor navigation races and
   no-send behavior. Parent owns broad integrated checks. Pure tests establish neither live-provider
   operation, actual author usability nor literary quality.
