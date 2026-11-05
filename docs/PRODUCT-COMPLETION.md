# Open Book Studio — product completion lanes

Reviewed against public `main` at `f3541f6750e60226ce8490e5ac192f10a1856dab` on 2026-11-05.
This is a dependency map for remaining work, not a statement that every proposed capability is
implemented or approved. The machine-readable graph is [product-completion.json](product-completion.json).
The [distilled requirements](completion-requirements.json) record stable IDs, current classifications
and acceptance criteria without including private research provenance.

## Two completion milestones

- **L23: desktop release sign-off.** Complete the supported desktop product and its installation,
  safety, accessibility, documentation and release evidence. Planned Android, glasses and audiobooks
  do not block this milestone.
- **L24: requested roadmap complete.** Close or explicitly defer every retained research-derived
  feature and platform lane. Each new capability still needs an accepted spec and relevant decisions.

The published CLI/MCP and ambient voice workflows are existing capabilities. Their lanes finish
conformance, preferences and gaps; they do not rebuild those features from scratch. The ambient
workflow records on the author's action and speaks the completed answer automatically. Always-on
listening, wake words and barge-in are separate, unimplemented behavior.

## Dependency graph

```mermaid
flowchart TD
  L00[Requirements and decisions] --> L01[Identity and docs]
  L00 --> L02[Files, recovery and sync]
  L00 --> L03[Models, keys and usage]
  L00 --> L21[Quality and accessibility]
  L02 --> L04[Editor, library and import]
  L02 --> L05[Agent control and context]
  L03 --> L05
  L04 --> L06[Story Bible and series]
  L05 --> L06
  L02 --> L07[History, notes and goals]
  L04 --> L07
  L04 --> L08[Deterministic review]
  L03 --> L14[Routing and spend policy]
  L05 --> L14
  L05 --> L09[Readers and continuity]
  L06 --> L09
  L08 --> L09
  L14 --> L09
  L02 --> L10[Illustrations and covers]
  L04 --> L10
  L04 --> L11[Formatting and publishing]
  L10 --> L11
  L03 --> L12[Voice and ambient]
  L05 --> L12
  L02 --> L13[Voices and audiobooks]
  L06 --> L13
  L12 --> L13
  L02 --> L15[CLI and MCP conformance]
  L05 --> L15
  L02 --> L16[Browser product]
  L03 --> L16
  L04 --> L16
  L05 --> L16
  L16 --> L17[iPhone and iPad]
  L12 --> L17
  L16 --> L18[Android]
  L12 --> L18
  L17 --> L19[Glasses and companion]
  L12 --> L19
  L15 --> L19
  L01 --> L20[Desktop packages and updates]
  L02 --> L20
  L03 --> L20
  L21 --> L20
  L01 --> L22[Guides, samples and film]
  L04 --> L22
  L05 --> L22
  L10 --> L22
  L12 --> L22
  L15 --> L22
  L04 --> L23[Desktop release sign-off]
  L05 --> L23
  L11 --> L23
  L12 --> L23
  L15 --> L23
  L20 --> L23
  L21 --> L23
  L22 --> L23
  L07 --> L24[Requested roadmap complete]
  L09 --> L24
  L13 --> L24
  L14 --> L24
  L18 --> L24
  L19 --> L24
  L23 --> L24
```

## Execution and ownership

Use four concurrent lanes where useful: three bounded builders/researchers and one real-app auditor.
The graph does not require starting every lane at once. Edges identify required contracts: an
existing verified implementation may already satisfy one while other work in that lane remains.
A lane may implement an independent slice before all predecessors finish; its final acceptance
cannot claim dependent behavior that has not been proven.

1. Reconcile requirements and accepted decisions before creating duplicate feature specs. Keep
   source research private and publish only original, product-focused requirements.
2. Assign each dispatch a tested base, owned files, one acceptance slice and a return artifact.
   Independent code changes use separate prepared worktrees. Keep documentation ownership explicit.
3. Audit the real app throughout: saved files, keyboard paths, permissions, failure states and the
   difference between configured capability and an exercised provider/device. An audit finding
   becomes a bounded follow-up; it does not create a cyclic dependency in this graph.
4. Integrate small changes and run the relevant exact-commit gates. Never lower coverage or a gate,
   alter performance baselines to hide failures, or substitute a lane's earlier result for the
   integrated candidate's evidence.
5. Record actual reported usage/cost. An unreported or zero-filled cost field is not proof that a
   model call was free. New paid workloads, native signing, store submission and hardware tests have
   explicit access/consent boundaries.

The node records define scope, current evidence, dependencies and the exit condition for every lane.
The broad research themes are proposals until the applicable spec/decision is accepted. In
particular, automatic dispatch/fallback, hard spend ceilings, autonomous multi-turn authority,
cross-device trust, real-device distribution and glasses transport are not implied by a graph edge.

## Current next work

Research reconciliation recommends reusing the existing specs rather than duplicating them. The
next genuinely new proposals are structured reader/continuity review (039), Android (040),
dedicated cover design (041), and narrator/character casting with audiobook creation (042).
These numbers are a proposed sequence, not a claim that those specs or features have landed;
038 remains owned by the voice-options candidate. Publishing validation extends 035 and depends
on measured output/rule contracts; conversational review remains distinct under 037.

- Reconcile spec headers/index/task evidence and remove stale claims of missing implementations.
- Finish the Open Book Studio display rename without changing credential or data identities.
- Integrate the tested voice-options candidate and recheck the supported flow in the public checkout.
- Complete a film with library-to-book navigation, distinct features and labelled multi-chapter
  fixture flips; preserve the submitted upload while its replacement is reviewed.
- Prioritize unresolved data-safety contracts before broadening agent authority or remote surfaces.

Release links belong in the repository only when their artifacts are ready. A configured installer,
responsive viewport, Simulator capture or successful submission is not by itself release evidence.
