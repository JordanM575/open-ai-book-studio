# Product completion map: design rationale

This rationale explains the current recorded product direction for the
[completion graph](PRODUCT-COMPLETION.md#dependency-graph). It does not claim a new historical
approval, measured delivery outcome or decision beyond the direction already recorded in the
[retained-scope record](RETAINED-DELIVERY.md) and [decision register](DECISIONS.md). Detailed
contracts and any still-open choices remain with their owners.

## Release milestone alternatives

**One all-target sign-off.** A single milestone covering all retained features and platforms gives a
simple answer to whether the entire roadmap is done, and a single whole-product acceptance boundary.
It avoids maintaining two differently scoped release claims. Its cost is that an unrelated native,
companion or audiobook target would block a separately supportable desktop release, even if that
desktop candidate and its actual support matrix had complete evidence. It also defers feedback on
the independently useful desktop product.

**Supported desktop L23 plus all-retained L24 — selected.** L23 can be accepted for an explicitly
supported desktop feature/target matrix, with candidate-specific evidence and release approval;
L24 separately requires direct acceptance of every retained lane L00–L23. This preserves parallel
delivery and avoids treating unrelated targets as desktop blockers. Its costs are maintaining a
precise matrix, two milestone definitions and 24 direct obligations as scope evolves, preventing
metadata drift, and gathering traceable evidence for both the slice and the complete roadmap. The
premature-claim risk is material: leaving a capability outside L23 does not implement or accept it,
close its full retained lane, or close L24. Only an explicit author-approved scope change can change
retained scope; the two milestones create no additional deferral authority.

## Dependency alternatives

**Whole-lane serial sequencing.** Requiring every upstream lane to be fully completed before any
downstream work gives a simpler whole-lane interpretation and fewer applicability judgments. It
would, however, serialize independent work: a narrow export would wait for unrelated cover work,
and an Android editor slice would wait for all voice work. It also risks treating optional planning,
character and routing relationships as universal blockers. That scheduling simplicity does not
reduce the evidence required for the eventual whole retained lane.

**Contract-level edges and independent slices — selected.** A solid edge gates the applicable
upstream contract at acceptance of the downstream lane's whole retained scope, while independent
slices may proceed once their own prerequisites are satisfied. Cover-dependent export and Android
voice claims carry the relevant contract; other export or Android slices can advance separately.
The three dashed relationships are independent and apply only to their own stated source or routing
condition. The [edge register](PRODUCT-ACCEPTANCE-GATES.md) makes the applicable claim, contract,
required evidence and refusal explicit. The cost is 66 records and their owner links to maintain, a
risk of graph/register/implementation drift, and the evidence burden of evaluating each applicable
claim rather than inferring acceptance from an arrow. A missing contract must remain a visible
no-claim or refusal, not a shortcut to full-lane acceptance.

## Direct terminal coverage

The eight existing sequencing arrows into L24 remain unchanged. Separately,
[product-completion.json](product-completion.json) enumerates L00–L23 as a direct conjunction of
retained-lane acceptance. This is not a transitive reachability argument or a set of extra diagram
arrows. The structural validator checks exact membership and register consistency; it cannot
establish that acceptance evidence actually exists, that implementation quality is adequate, or
that an open decision has been accepted.
