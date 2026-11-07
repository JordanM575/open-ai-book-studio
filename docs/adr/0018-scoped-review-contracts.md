# ADR 0018: explicit review envelopes and exact evidence

**Status:** Accepted, 2026-11-07, under delegated feature-delivery authority.
**Decision:** D-193. **Scope:** U-037-01/02 and U-039-01/02/04; pure contracts first.

## Context

Ordinary Discuss mode is a no-mutation boundary, not a selected-source boundary. Current ordinary
agent prompt/history/tool construction can read a full book, outline, memories and SKILLS. Reusing
that assembly unchanged would disclose unselected content. Existing review/editor UTF-16 spans
are useful, but hostile model quotations need independent bounds and excerpt verification.

## Accepted envelope and execution boundary

A foreground review has a host-generated request ID and digest bound to destination, prompt,
selection order, immutable selected source text/identities, optional explicitly selected prior
feedback and contract version. Disclosure and provider serialization derive from the same
validated envelope. Include selected text up front. No implicit ordinary book prompt, SKILLS,
history compaction, cast, outline, memories or metadata prose enters the request.

Only a captured-source facade is available to the review executor. It uses the existing six read-tool
names with scoped implementations: selected TOC entries, selected chapter spans, selected-content
statistics/search, and explicitly selected Story Bible fields. A source not selected is unavailable,
not fetched on demand. Disabled, plugin, write, destructive and unknown tools are withheld and
execution-denied. Source/profile text remains data; it cannot widen authority.

Local library resolution may inspect container metadata and chapter candidates under existing ID
lookup rules. This is not a promise of zero other local filesystem reads; no unselected content may
enter the executor, envelope, tool result or provider request. Unsupported hosts refuse before source
preparation. Never accept renderer-supplied absolute paths as an ID-lookup shortcut.

Immediately before explicit provider-named Start, revalidate selected revisions/values, destination,
capabilities and each included book's applicable consent. Any change returns to disclosure with zero
sends. There is no implicit refresh, fallback, retry or background authority. Stop prevents later
dispatch best-effort and states that already-sent text cannot be recalled.

On Start, the request, exact selected text, results, citations, attribution and answer belong in the
existing conversation, with visible disclosure that selected full chapters can therefore be retained
and travel with the book. Unsent previews stay transient. Rerun has a new identity and authorization;
same prompt text is insufficient to reuse a request. Later ordinary agent replay must not silently
expand review-source parts into its prompt.

**Persistence prerequisite:** current thread updates/deletion do not yet prove checked/recoverable
storage. Before enabling durable review parts, deliver a separately reviewed shared thread-safety
contract and format change: expected-hash updates, conflict preservation, recoverable deletion,
versioned parts, safe legacy reads and future-version refusal. This ADR authorizes the pure envelope
and evidence modules now; it does not bless the existing unchecked thread writer or choose an
untested migration by implication.

## Exact evidence

Manuscript references carry book/chapter identity, saved version, raw-file SHA-256, full-body
half-open UTF-16 offsets and exact quote. The span must lie entirely inside an explicitly selected
range, use integer in-bounds offsets, avoid split surrogate pairs and equal the captured substring.
No normalization, whitespace folding, fuzzy lookup or nearest-match relocation makes a quote exact.
Source canonicalization occurs only through the existing saved-file reader before capture.

Display book/chapter labels, derived body-line range, saved version and capture time, not raw IDs or
hashes. Recheck current source identity/version/hash and clean destination-editor state before
selection. Stale/unavailable evidence retains its historical quote; it never highlights guessed text.
Story Bible references use selected field/record identity and value digest, with containing-file hash
as provenance; they do not pretend to have chapter versions. New 030 records require their own
accepted identity and navigation contracts before inclusion.

Model findings contain finding/category/reader-version/run identity, interpretation and evidence.
Only the verifier derives current/verified state. Categories are reader-impression, clarity, pacing,
character-motivation and continuity. All interpretations are labelled subjective. A contradiction
requires at least two valid references; otherwise it is a question or insufficient evidence. Invalid
citations are withheld from navigation and counted as incomplete evidence; malformed top-level or
over-limit output fails without an automatic repair request.

## Reader profiles and bounds

Initial built-in lenses are fictional **Alpha reader** (structure/motivation/clarity) and **Beta
reader** (reading experience/pacing/confusion), with immutable IDs and integer versions. Editing
creates an author profile/version with a content digest; an earlier run keeps its complete profile
snapshot. Same-name lenses remain distinguishable. Compare source/profile/provider changes
separately from changed interpretation; model variation is not an improvement score.

| Resource | Initial contract |
| --- | --- |
| Selected books | At most 4; first UI supports one under the same bound |
| Selected source items | At most 64 total; merge overlap and show resulting scope before Start |
| Selected source text | At most 65,536 UTF-8 bytes |
| Source + prompt/profile/selected feedback | At most 131,072 UTF-8 bytes |
| Complete serialized model request, including trusted instructions/tools/schema | At most 262,144 bytes |
| Provider output | At most 262,144 bytes |
| Findings | At most 50, 2,000 Unicode scalar values per interpretation, 8 evidence items per finding |
| Exact quote | At most 500 Unicode scalar values; reject over-limit evidence rather than falsify a quote |
| Editable reader guidance | At most 2,000 Unicode scalar values |

These are explicit first-release UX/resource choices, not measured provider-fit or literary-quality
thresholds. Implementation must test exact boundaries, multibyte strings and total serialization.
Over-limit input blocks Start with a smaller-selection action. Never silently clip, summarize, omit
a book, split into extra paid calls or change model. Unknown context fit stays Unknown even if a
catalog context size is known; characters/4 is not a proof. Provider overflow leaves a failed/incomplete
run for an explicit retry. Missing consent for one book blocks the entire proposed request.

**U-039-04 remains a prerequisite of both T003 and T006.** Its one-book exemption is rejected; one
large chapter can overflow. This ADR resolves its policy rather than removing the gate. Pure contract
work is independent of a later multi-book picker and 030 planning records.

## Separate work retained

Reports/profiles remain volatile until D-171/U-039-03 are individually accepted with their storage
contract. Broader autonomous authority, scheduling, candidates, strict spend enforcement, routing,
cover storage/rendering and audiobook jobs retain their own design/implementation work. No retained
roadmap feature is deleted or marked implemented by choosing a narrow first review slice.

## Verification

Use synthetic selected passages with sentinel text in adjacent/unselected sources; compare exact
disclosure/request/tool payloads, no-send cancel/changed-source/consent failures, malicious source
instructions, Unicode/repeated quotations, wrong IDs/revisions, profile lineage, output bounds and
stale navigation. The research premise tests and this decision do not establish implemented review
or an actual user study. A synthetic author journey is required before integration; usability and
model-quality evidence must be reported honestly rather than inferred from quote validity.
