# First feature wave: review and verification

## Candidate and scope

PR #32 combines the first Discuss/Edit and one-turn-guidance implementation with four-format
manuscript destination protection and typed export warning receipts. Candidate `c418b2fc` contains
the reviewed planning/review policy corrections from PR #31. History, planning/goal sidecars,
structured reader review and the shared filesystem adapter repair are separate candidates.

## Evidence on c418b2fc

- Full `bun run verify`: **2,387 tests passed**, zero failures/skips; lint, typechecks,
  quarantine/waiver checks and desktop/web builds passed.
- Coverage: **92.93% functions / 94.73% lines**, over 233 repository files; existing floors pass.
- Toolkit build passed. Full e2e: **11 of 12 suites passed**. Smoke passed 45 of 47 checks;
  the other suites passed, including the isolated mock-provider agent journey, browser storage,
  desktop/phone-width audits, toolkit, plugins, bridges, offline writing/export and second instance.
- Smoke's two failures were an obsolete empty-state text assertion and its resulting open-panel
  contamination of the later retry check. The Markdown omission warning was visible and passed.

This is synthetic automated evidence. It does not establish live-provider quality, native-device
conformance, distribution approval or film provenance.

## Independent findings and coordinator corrections

| Finding | Correction in the follow-up candidate | Focused evidence |
| --- | --- | --- |
| W03 R1: unconditional failure persistence can throw during validation before the terminal event | Move validation inside the best-effort persistence boundary; bound stored provider detail explicitly and preserve long wait/checkpoint explanations without clamping the live wait | Long error, two-day retry wait, invalid partial output and failed write tests through the real mock-model runtime; terminal events release composer controls |
| W03 R2: stale smoke copy and panel cleanup | Assert Discuss read-only, explicit Edit and destructive-approval copy; reuse cleanup on the first panel check | Revised built smoke must pass before acceptance |
| W05 F1: previous or late export receipt appears in another book | Bind all async UI updates and preflight to a book-view/request generation; clear view state and ignore obsolete errors/finalizers/timers | Both header formats: completed receipt, same-book cancel, A→B→A, new pending B request, late error, unmount and delayed save |
| W03 documentation note: older task notes sound current | Mark schema/decision-stage limitations historical and point to W03 implementation evidence | Current task checkboxes retain their original scope |

Coordinator focused runs after these changes: **68 runtime/composer tests** and **42 export
component tests** passed; all workspace typechecks passed. The source revision still requires its
own built smoke and final integrated gates. Raw independent reports and failing reproductions remain
preserved; these corrections do not rewrite their exact-head verdicts.

## Remaining acceptance

The f2bdf100 follow-up passed full verify (**2,404 tests**), coverage (**92.93% / 94.73%**),
all **47 smoke checks** and **12 e2e suites**. Independent review accepted the agent correction and
header export correction. A retained Format-dialog gap was then reproduced: a delayed save could
submit an old-book export after navigation. The next correction applies visit/request ownership
before and after every export await, with 24 all-format delayed chapter/matter-save scenarios
covering navigation, return to the same book and unmount. Its focused run passed **84 tests**;
all workspace typechecks and focused lint passed. This last change requires its own affected
integrated gates and independent recheck before merge.

The full spec 031 plan lifecycle and remaining spec 035 folder-export/conformance work stay open;
this review does not claim either whole spec complete.
