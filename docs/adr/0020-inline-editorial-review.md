# ADR 0020: Exact-source inline editorial review

**Status:** Accepted, November 7, 2026, under delegated feature-delivery authority.
**Decisions:** D-197–D-199, D-201 and revised D-171. **Owners:** 033/034/039.

## D-197: Interaction and editor

One manuscript-adjacent Review workspace exposes separately labelled local indicators, subjective
editorial feedback and reader lenses. Run/chapter/category/freshness/disposition filters are local
operations. Underlines appear for an explicitly selected review layer; hiding/filtering does not
delete findings or start a provider. The accessible sidebar exposes the same quotation, explanation,
source location, attribution and actions without relying on hover, color or hundreds of tab stops.

Use minimal CodeMirror 6 plain-text state/view decorations behind the existing manuscript save/draft
wrapper. Keep exact canonical Markdown, LF and UTF-16 coordinates. Preserve one undo owner: the
current custom history initially, with CodeMirror history disabled. IME, paste, dictation, hold/rebase,
selection and flush semantics must pass before replacing the mounted textarea. A source adapter
alone is not product integration. New dependencies require license, bundle and existing performance
gates. Reject transparent textarea mirrors, hand-built contenteditable and a rich-text storage rewrite.

Verify owner/source kind/ID/version/raw hash, fatal UTF-8 and canonical body, selected-range containment,
safe integer offsets, exact quote equality and surrogate-safe endpoints. Malformed Unicode refuses;
no normalization or fuzzy matching. The final editor handle validates current view/library/book/chapter,
clean body equality, saved token and non-composition state after navigation awaits. No current marks
from dirty/stale/unavailable sources. Edits invalidate marks synchronously; position mapping cannot
certify source currency. Historical quotes remain inspectable. Metadata-only changes stale raw tokens.

Use a pure endpoint-sweep interval index retaining all finding/evidence IDs in overlaps. Discontinuous
evidence never spans gaps. Order overlap choices deterministically. Keyboard previous/next, inspect,
return and disposition actions have visible equivalents. Preserve focus through filtering and paging,
test bidi/combining marks/ZWJ/long lines, light/dark/forced colors/200% zoom/reduced motion. Existing
120-chapter/250k-word and total-web-JavaScript gates remain. New filter/navigation performance targets
must name a measured host; the research's 100ms/50ms suggestions are not accepted measurements.

## D-198: Findings, metrics, application and full-book coverage

Keep v1 categories unchanged. Versioned v2 adds clarity/readability, voice/line craft, pacing/structure,
character/motivation, continuity/world and reader-experience groups; findings distinguish concern,
strength and question. Priority is attributed triage, never objective severity/quality/confidence.
Contradictions need two distinct verified references. Optional genre/intent lenses are explicitly
selected guidance with immutable profile snapshots, not real-reader impersonation or hidden context.

Select repetition v1 as the next 034 metric: overlapping three-token windows within each chapter,
all occurrences counted. Tokens use Unicode letters/numbers and combining marks with internal
straight/curly apostrophes; comparison keys are NFC, locale-independent lowercase, U+2019 unified to
U+0027. Keep original UTF-16 spans. Punctuation separates tokens; windows can cross sentence punctuation,
never chapters. No stopword removal, stemming, ideal-frequency threshold or overuse verdict. Shared
word counts and explicitly labelled body-line lengths are deterministic. Session-only author literal
watchlists may highlight exact matches. Grammar/passive/telling/adverb judgments remain subjective
until a separately licensed/versioned language analyzer is selected. Pagination never hides coverage.

Disposition is independent of freshness: open, ignored, author-resolved, reopen. No global suppression
or automatic resolution when a finding disappears. Rerun creates new identity/source/profile snapshots;
same-input variations are not measured improvement. Related findings across changed revisions require
explicit relation, never quote-search relocation or inherited dispositions.

Select explicit one-span suggestion preview/application as a separate author command. Generation
stays read-only. Preview exact old/new text including line breaks; verify current clean source again,
refuse during composition, apply one isolated editor undo unit through normal checked save. No paste
normalization hidden in model replacement. Show draft/saving until exact saved body confirmed. Conflict/
failure keeps the draft and original external text; cannot mark applied/resolved. Saved chapter with
failed review-state persistence stays “Text saved · review state not saved”, with no repeated apply.
Durable undo uses independently accepted history integration, not a promise from in-memory undo.

Full-book critique uses a new explicitly disclosed campaign, not silent splitting of ordinary v1
overflow. Plan all selected canonical ranges plus disclosed boundary context, with scalar-safe splits
and no gaps. Keep ADR 0018 per-request limits (4 books/64 sources; 65,536 source, 131,072 combined,
262,144 serialized request/output bytes; 50 findings, 8 citations, 500 quote/2,000 interpretation scalars).
Union primary coverage by source revision/category/profile; overlaps do not double-count. Source
coverage, execution, evidence, synthesis and currentness are separate. Synthesis uses attributed
derived summaries but claims still cite original exact sources. Failed stages stay incomplete;
bounded finding output is not exhaustive detection. Campaign state grants no scheduler authority;
037 owns attempts, budgets, retries and check-in direction.

## D-199 / D-171: Explicit saved review ownership

Volatile by default; explicit Save review retains authored feedback. Workflow retention is separately
disclosed by ADR 0019. Viewing, filtering, rerunning and unsaved dispositions write nothing to threads
or files. No automatic 20-report eviction, direct unlink or impossible folder-sync exclusion.

| Location under `books/<ownerBookId>/reviews/` | Contract |
| --- | --- |
| `<runId>.json` | Immutable, absent-only report, kind/schema/run/profile/analyzer/source attribution, coverage/findings/quotes; no full source bodies or provider wire payload |
| `dispositions/<runId>.json` | Checked revision/raw hash, owning report hash, finding IDs and author event history |
| `profiles/<profileId>.json` | Checked authored lens; built-ins need no file, reports retain their used snapshot |
| `campaigns/<campaignId>.json` | Source/stage manifest, planned/actual coverage and synthesis references, not embedded reports or execution permission |

Each document is at most 2,500,000 serialized UTF-8 bytes including unknown fields. Preserve lossless
supported plain data, exact numeric values and owner identity; refuse future/corrupt/oversized data
without rewrite. Same-ID/equal-bytes save is idempotent after verification; unequal bytes conflict.
Detailed schemas, segmented occurrence/disposition continuation and related-file recovery must be
added to FORMAT before those writers. D-201 specifies, but does not implement, campaign continuation
below. A full document refuses with the draft retained; it
never trims history to fit. Reports and dependent files move recoverably to trash, never auto-prune.

Archive/sync includes these ordinary author files and quotations; overflow refuses rather than omits.
Source deletion does not erase quotes explicitly saved under another owner. Historical full bodies
require an explicitly selected valid 032 snapshot; saving a report creates no implicit history capture.
Distinguish verified-at-capture from current snapshot verification. Copy/Markdown export includes
scope/profile/model/rule attribution, quotes, captured revision, export-time freshness and dispositions,
via the safe output path. No secrets/raw errors/credential-bearing URLs or hidden conversation data.

## D-201: Conditional campaign continuation

The accepted [campaign continuation format](../formats/campaign-continuation.md) uses a checked
`review-campaign` schema-2 manifest, immutable schema-1 plan/checkpoint token segments and an
immutable publication intent. It preserves the complete planner content except its digest; selected
source text, generated stage prompts and prior-feedback arrays are external at four exact typed,
path-bound, canonical length/digest-checked locations. Exact reconstruction and continuation depend
on independently validated originals and compatible planner validation; otherwise the retained
structure is inspectable but unavailable. It is not a self-contained or offline-availability promise.
An explicit author-selected valid 032 snapshot may supply a historical body; saving does not capture
history, conversations, summaries or provider payloads, and stored references grant no execution
authority. A self-contained archive requires a separate retention/privacy decision.

The format preserves the existing per-document, ordinary request and schema-1 limits and adds bounded
operation-specific ceilings. No eviction, truncation, silent migration or loss of supported unknown
fields is permitted. Known metadata and unknown fields can be sensitive: explicit Save requires a
disclosure and a host-established non-secret opaque endpoint identity, never any URL or credential.
Segment and intent publication precedes a last checked manifest; immutable readback and explicit
recovery do not themselves prove cross-writer atomicity. Production mutation requires the format's
independently proven conditional-write/immutable-create or exclusion capabilities. Three-component
campaign group moves likewise require their specified directory/no-replace or exclusion guarantees;
unsupported adapters refuse mutation. Reports and dispositions remain independently owned, and
cross-book report references require a separately authorized read/identity seam.

The detailed schema, canonical identities, limits and recovery classifications are normative in
[FORMAT](../FORMAT.md#saved-campaign-continuation-manifest-schema-2-segment-and-intent-schema-1).
The acceptance does not implement a codec, storage writer, compatible planner registry, group move,
archive, host execution or adapter conformance. Those, independent review and the remaining 039 gates
are still required.

## Evidence and alternatives

The author requires source-linked critique, reader lenses, series continuity, local repetition
diagnostics and suggestion-only grammar/style review. Underlines must identify exact source passages
and remain separate from an author's decision to apply a change. These requirements do not establish
an implemented report, a validated scoring rule or a qualified language engine.
[CodeMirror guide](https://codemirror.net/docs/guide/) and
[decorations](https://codemirror.net/examples/decoration/) support the selected plain-text architecture.
Existing editor/review source and completed independent audit establish gaps, not new UI evidence.
Semantic usefulness, accessibility, large-manuscript performance and live literary quality have
separate future acceptance gates. Diagnostic rules must be documented and independently tested.
