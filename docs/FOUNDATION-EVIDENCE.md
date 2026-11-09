# Foundation evidence — November 9, 2026

This public-record reconciliation is anchored to `main` at
`0fc19f39189aab078c687178060cedf968b5359e`, the merge of PR #45. It attributes historical
statements to their linked receipts; it does not reproduce their tests or certify a later head.
Implementation, automated checks, independent acceptance, provider behavior, native-device evidence
and release approval are separate facts. Overlapping focused and broad runs are never added together.

A PR body is mutable. A request for review, an automated review, an accepted earlier leaf and a
merged PR do not establish independent acceptance of the final composition. “Not located” below
means no equivalent receipt was identified in the public materials examined, not that no review
occurred. See the [forecast](DELIVERY-FORECAST.md) for next work and the
[spec index](../specs/README.md) for retained task owners.

## Exact heads and public attribution

All rows below are merged. PR links supply the public body and merge metadata; more specific
receipts are linked where available. Full head and merge IDs distinguish review targets from
integration results, including squash merges.

| Foundation | Final PR head | Merge | Independent acceptance attribution and limits |
| --- | --- | --- | --- |
| [#26 · Voice options](https://github.com/JordanM575/open-book-studio/pull/26) | `43d3bc258c7ff0ee8ff3f1e522d08b47dd623e85` | `98571e567b52ef53495f3f80eefb6888acad1b2f` | No exact-head independent acceptance receipt located. The [dated task ledger](https://github.com/JordanM575/open-book-studio/blob/dd03059b8edcb2bc3e8747bbc46140fdf41ffad2/specs/038-voice-options/tasks.md) explicitly attributes integrated automated evidence to this head; T022 stays unchecked. |
| [#29 · Linux workflow](https://github.com/JordanM575/open-book-studio/pull/29) | `6b9fc9d9adc2c0e6dd736110136021d279cf38bd` | `55b55b8beae73e4a8f2d1f566c3ad33fccdc6b34` | No exact-head independent acceptance receipt located. [Run 42391731698](https://github.com/JordanM575/open-book-studio/actions/runs/42391731698) is automated evidence in a manually dispatched workflow. |
| [#30 · Documentation baseline](https://github.com/JordanM575/open-book-studio/pull/30) | `b69b5b0b761aae4b4d6f59c2d83d877322ef256d` | `210748c2aabbe91429b9fbe2b8b14f98be8aa7de` | [Approval with nits](https://github.com/JordanM575/open-book-studio/pull/30#issuecomment-6713125822) names earlier `1844285e2dbb83e131e691393ed7ec6c9b4c394c`; an updated-head check was pending. |
| [#32 · Interaction/export](https://github.com/JordanM575/open-book-studio/pull/32) | `053620da343cc4d88677387b55adde424ee2aa34` | `fe4ec0f0592010d51efee6c1e13ddf289118287a` | Body attributes bounded correction acceptance to earlier `f2bdf10091b197a04a49c0da7e9178a250374fc8`; final Format-dialog recheck was pending. |
| [#33 · Saved history](https://github.com/JordanM575/open-book-studio/pull/33) | `7515c3b6c7df34f59eadedbcd101fd666e866e8e` | `a9997624ac28b970c0a656c50233753ad375982f` | Body attributes independent acceptance to history leaf `6d9e658c9511d8275fcb1b8129d05b55af323893`, not this combined final head. |
| [#34 · Checked restore/isolated UI](https://github.com/JordanM575/open-book-studio/pull/34) | `56c7b7dbc756981994796156cf1efc5abe248ae3` | `c2089ca73e0fa315bc891b463d4e3cf840082344` | Body attributes fresh independent core/UI acceptance to this exact final head. Scope is checked saved-source restore/undo and an isolated injected history dialog, not the mounted host journey. |
| [#35 · Planning/stop composition](https://github.com/JordanM575/open-book-studio/pull/35) | `e3285962a258e1f6c2b0cc0518a1118d6b72c1aa` | `f29ec0803d9f0c210d33f47ccb91d5478d3a7a7b` | Body attributes acceptance to earlier `73b8241bb1932c698be1930d46105611b57467ec`; it does not establish final-head acceptance after later quit corrections. |
| [#36 · Authoring/voice/review/editor leaves](https://github.com/JordanM575/open-book-studio/pull/36) | `93d8a89f96f8b5e130140e6b8b83a69295cfd59b` | `a6428b245494c1d3e35dc3fe105de3df10eeeab0` | Body attributes composition acceptance to earlier `37a6e1a0f6fef0da7900b22bd77b2056efa65cb1`; separately accepted leaf IDs appear below. |
| [#37 · Permission/verifier/workflow codec](https://github.com/JordanM575/open-book-studio/pull/37) | `b2567433b7f0bcfcfdb24654fb343ac99954edc5` | `e79777cf9d2e8a7bfb92ccc93f556c77a46f8271` | Body attributes three distinct leaf acceptances, not independent acceptance of this final composition. |
| [#38 · Checked threads](https://github.com/JordanM575/open-book-studio/pull/38) | `cceb8a7a908947b104186ff4d9af09022d16a299` | `d95f850f6a16a92452166e6b6ca9afe074b549f7` | Body says a recheck accepted “this head” without a SHA. A later [correction](https://github.com/JordanM575/open-book-studio/pull/38#discussion_r4507350645) names the final head; exact reviewed correction is ambiguous. |
| [#39 · Mounted editor](https://github.com/JordanM575/open-book-studio/pull/39) | `07ff653bf2a3607bcd84a65d1a1adee5946c1f39` | `3145208bdba9f5a6b758dcb4eea3f45c07c75570` | Body identifies review of earlier `15d0cac31f150c7516fdcaffd1a1bb9aa310aac4` with two subsequently fixed UI findings. No final-head independent acceptance receipt located. |
| [#40 · Voice transport](https://github.com/JordanM575/open-book-studio/pull/40) | `d6268eb5792ec8ccf94afdb6e2f77af00c97bcb5` | `95fed8076daefd32eddcb899e0b40563153af51f` | Body reports ledger review and two corrected defects without the reviewed SHA; final-head independent acceptance is not established. |
| [#41 · Saved-review records](https://github.com/JordanM575/open-book-studio/pull/41) | `920fc4e0899d95bd25d737eac76098043ea29ba6` | `9e756ef3266acc1dd7170b5c222d0ba1add21672` | Body identifies review of earlier `90eaa620ff1f03449823137a08a2609c19ba9e15` and four later-fixed P2 findings; no final-head independent acceptance receipt located. |
| [#46 · Campaign planner](https://github.com/JordanM575/open-book-studio/pull/46) | `2045fa53e8276004799c91957ba1cc88eab6b469` | `eddb0847c3988c3736e0a712aa726c48de5c7e08` | The [correction](https://github.com/JordanM575/open-book-studio/pull/46#discussion_r4507972714) still requires fresh whole-candidate review. [Final-head automated review](https://github.com/JordanM575/open-book-studio/pull/46#issuecomment-6727760077) is a separate receipt. |
| [#47 · Saved-review controls/recovery](https://github.com/JordanM575/open-book-studio/pull/47) | `2d791d080604ba84395310b798b8a28cb5c6988c` | `c58c8625e870360c20d4fed61eeb4265812e200e` | The [final-head request](https://github.com/JordanM575/open-book-studio/pull/47#issuecomment-6728093221) keeps independent review separate from its focused results. [Automated review](https://github.com/JordanM575/open-book-studio/pull/47#issuecomment-6728112477) is not that acceptance; no equivalent receipt located. |
| [#42 · Synthetic Discuss seam](https://github.com/JordanM575/open-book-studio/pull/42) | `20685587867d7281530a6765b106d99998af432a` | `19ea1c791c586e64c957f2c43eb379b33d2056e9` | A later [public forecast](https://github.com/JordanM575/open-book-studio/blob/dd03059b8edcb2bc3e8747bbc46140fdf41ffad2/docs/DELIVERY-FORECAST.md) attributes independent acceptance and five gates to this head. The earlier [request](https://github.com/JordanM575/open-book-studio/pull/42#issuecomment-6728597183) and [bot review](https://github.com/JordanM575/open-book-studio/pull/42#issuecomment-6728619294) are separate. |
| [#44 · Manual planning](https://github.com/JordanM575/open-book-studio/pull/44) | `ac345ea28dfede2f38e927672fd3ff878d0395b0` | `6c942739ea581bf38ca24a4947caf9dde2f92f92` | [Final-head request](https://github.com/JordanM575/open-book-studio/pull/44#issuecomment-6730589735) and [automated no-major-issues review](https://github.com/JordanM575/open-book-studio/pull/44#issuecomment-6730617903) are public. No equivalent final-head independent acceptance receipt located. |
| [#43 · Workflow storage](https://github.com/JordanM575/open-book-studio/pull/43) | `5d80c543868a7ce9dee65de7fe18834653525775` | `d9b6b16e1e9012df86d631c73ffc94a15e9c1056` | [Coordinator acceptance receipt](https://github.com/JordanM575/open-book-studio/pull/43#issuecomment-6732204100) attributes independent whole-candidate acceptance to this exact final head. |
| [#45 · Repetition findings](https://github.com/JordanM575/open-book-studio/pull/45) | `7087a3fffd2c72106335e62c9b642f2f7f434a1d` | `0fc19f39189aab078c687178060cedf968b5359e` | [Coordinator acceptance receipt](https://github.com/JordanM575/open-book-studio/pull/45#issuecomment-6732818306) attributes independent whole-candidate acceptance to this exact final head and tree `3d463c0b775c18625523d802dd64390ddf43e873`. |

The first-parent order is **#46 → #47 → #42 → #44 → #43 → #45**, not numeric PR order.
The [#44 merge](https://github.com/JordanM575/open-book-studio/commit/6c942739ea581bf38ca24a4947caf9dde2f92f92)
is a squash with parent `19ea1c7`; final head `ac345ea` need not be its ancestor. That merge ID is
not the reviewed PR head. #43 and #45 include their final heads as merge parents.

## Historical figures and acceptance scope

Each statement below belongs to the linked PR body or specific receipt above. It is historical
attribution, not a new run. Percentages are function / line coverage in that order.

- **#26:** the dated 038 ledger names final `43d3bc2` for typecheck, **2,280 verify tests**, coverage
  pass and **47/47 smoke**, with verify/coverage/smoke also recorded on merge `98571e5`. The mutable
  PR body's **2,266 / 46** figures do not name that tested SHA. Profile-local choices do not qualify
  a live provider, microphone, audible playback or native device. **038 T022 stays unchecked.**
- **#29:** three reported Linux runs have successful verify/e2e jobs; run 42391731698 names
  `55b55b8`. Either job now fails the manually dispatched workflow on failure. This is **not an
  enforced PR merge gate**. An earlier welcome failure was unreproduced; later race fixes do not
  prove absence of flakes. Target installers and macOS/device/release journeys remain separate.
- **#30:** the correction receipt reports **24 contract / 34 export tests** and typechecks, while
  still awaiting an updated-head check. Its older six-slot policy is superseded by the current
  five-child limit. Documentation evidence is not an application or live/device rerun.
- **#32:** final `053620d` has body-attributed **2,428 verify**, **92.93% / 94.73% coverage** and
  **5/5 affected e2e suites**. The **12-suite** result and bounded agent-terminal/header-export
  independent acceptance belong to earlier `f2bdf10`; the final Format-dialog recheck was pending.
- **#33:** history leaf `6d9e658` has body-attributed **95 focused tests**, independent
  codec/containment probes and strict typecheck. Combined final `7515c3b` separately has **2,500
  verify**, **93.03% / 94.83% coverage**, toolkit and **12 e2e suites**. Saved-only history and static
  containment do not qualify hostile path swaps, cross-process CAS, live draft gates or mounted UI.
- **#34:** the body attributes same-head independent acceptance at `56c7b7d` to **175 focused
  tests, 20 additional core probes, eight hidden Chromium scenarios and three typechecks**. Same-head
  coordinator gates separately record **2,580 verify**, **93.12% / 94.88% coverage**, toolkit and
  **12 synthetic e2e suites**. Checked restore/undo core and isolated injected dialog acceptance leave
  validated host/API/Workspace mounting, draft gates, confirmation/recovery and retention open.
- **#35:** **2,822 verify**, **93.20% / 95.12% coverage** and **12/12 e2e** belong to reviewed
  `73b8241`, explicitly not final `e328596`. Correction `bd01bab76ac7d80cd036ab281cc08eb9eef23f94`
  reports **190 tests / 962 expectations**; an intermediate hidden audit hung, and final gates were
  described as running. Planning/goal integration and terminal stop do not complete connected autonomy.
- **#36:** composition `37a6e1a` has body-attributed independent acceptance and **397 tests / 4,252
  expectations** twice. Later `23c7e53eb7b7a070a8cbd17378f9b77eb7c14b4d` reports **402 / 4,281**,
  with broad checks pending, not final-head results. Independently accepted leaves are authoring
  `aa4cef221680e5af0e8d22c3b951ade92e3b6138`, voice
  `a4ade8cb20669517bcb6a5d42d025f678c692a04`, review
  `35029328965b3812f24d332bb7482473a5564a45` and editor
  `6596aaef655c838c1bed2b1e9a17c7bbfb606657`. Host execution, mounted review and native voice remain.
- **#37:** accepted leaf IDs in the body are permission
  `9b13b65faf774b97ce05bacb237d1a93e5cea9b1`, verifier
  `73dbbd15b47b3a4ef89fd4a06ac26cd9c7681b48` and workflow codec
  `00d1878f6c9cfc15afb9b86039ac7f93abda06a7`. Composed **403 tests / 3,980 expectations** are not
  explicitly SHA-pinned there; broad gates were running. These do not qualify microphone grants,
  mounted hands-free execution, review UI, workflow writers/scheduling or release.
- **#38:** **16 independent probes / 235 unique focused passes** accompany the body's ambiguous
  “this head” recheck; do not assign them to final correction `cceb8a7` as exact-head acceptance.
  Backed-up v2 migration and restore IPC/UI remain. External races may yield uncertainty, not CAS.
- **#39:** earlier reviewed `15d0cac` has body-attributed **240 focused tests**, typechecks and
  **48/48 hidden smoke**, plus two later-fixed UI findings. Additional **12 mount tests / 71 related
  suites** are not SHA-pinned there. Full accessible review, current evidence/apply, native IME,
  screen readers/mobile and bundle/performance acceptance remain.
- **#40:** the body reports **249 focused tests at a builder head** and later **193 voice/dictation/
  settings tests / 3,091 expectations**, without a reviewed SHA. Do not add these sets or call them
  final-head broad gates. Production capture/IPC, abort ownership, accounting and target qualification
  remain; state-machine review does not establish connected voice acceptance.
- **#41:** review at `90eaa62` raised four later-fixed P2s and two P3s. The body's **268 tests /
  1,297 expectations** are not explicitly SHA-pinned. Later #47 supplies some IPC/UI/recovery work;
  039 T014/T015 still retain continuation, export/archive, complete recovery and connected execution.
  Captured quotations are verified-at-capture, not automatically current after saving.
- **#46:** final correction `2045fa5` reports **122 focused tests / six unchanged independent
  probes**, typechecks and touched lint, while still requiring fresh whole-candidate review/gates.
  The body's **175 tests / 975 assertions** belong to earlier
  `5eab21076384ecf5e9da053594f73abdd740fdc7`. Pure volatile planning does not qualify continuation,
  persistence, host/scheduler, mounted UI, provider quality or 039 T017 completion.
- **#47:** final-head request `2d791d0` reports **216 tests / 1,416 assertions** and typechecks.
  Its **3,473 verify**, **93.77% / 95.55% coverage** and **12/12 e2e** name earlier
  `c84c13cd0a441d32fcc0a4a1f1577258ee01cd07`. Current-head review/gates were separate. Partial-move
  uncertainty, lack of a multi-file transaction, continuation/export/archive, native accessibility
  and connected execution remain; 039 T014/T015 are open.
- **#42:** final-head request `2068558` reports **408 maintained tests / 4,957 assertions** and
  **67 unchanged independent probes / 413 assertions**. The later public forecast attributes
  independent acceptance, automated/security review and five gates without numerical broad totals.
  Scope is a synthetic **single-realm** host seam. Actual capture/IPC, audio, provider disclosure,
  lifecycle and device acceptance remain; 017 T017 and 038 T022 stay unchecked.
- **#44:** final-head request `ac345ea` reports **282 focused tests plus preserved recovery
  probes** and separately coordinates independent acceptance and broad gates. An earlier
  [source-component correction](https://github.com/JordanM575/open-book-studio/pull/44#discussion_r4508535968)
  reports eight Chromium journeys and **277 tests / 1,759 assertions** at another integrated head.
  The old line-ending/full-copy/order-identity findings are corrected in the merged work, not still
  outstanding PR fixes. Built-adapter/native accessibility and complete 030/033 acceptance remain.
- **#43:** final `5d80c54` acceptance records **42 unchanged failed-intent tests / 486 assertions**.
  Same-head gates: frozen install, **4,066 verify**, **93.99% / 95.56% coverage across 316 files**,
  toolkit and **12 e2e suites**. Settlement clears receipt **entry roots and registry entries**;
  retained closures and unsettled receipts may still reference captured state. Independently owned
  pending receipts and legitimate unsuperseded verified predecessors remain reachable as needed.
  Partial artifact-conflict-body preservation and failed journal persistence retain their stated
  limits. No measured leak, absence of a leak or fixed heap ceiling is established. Host permission,
  admission, scheduling, mounted execution/recovery and full-book acceptance remain; 037 T023 is partial.
- **#45:** final `7087a3f` acceptance names base `d9b6b16`, the reviewed tree above and all five
  gates: frozen install, **4,198 verify**, **94.08% / 95.61% coverage across 319 files**, toolkit
  and **12/12 e2e**. Lazy selected-passage verification leaves worker aggregates **unverified**;
  it does not prove completeness, counts, coverage or absence of omitted findings. Direct source-read
  failures are separate evidence. Packaged-worker/CSP, native accessibility/IME/navigation, inline/
  retained-report/host/provider-quality and release acceptance remain. 034 T016/T018/T019 and
  038 T022 stay unchecked; inherited journal wording has the #43 entry-root qualification.

## Use in the delivery plan

These bounded foundations support the next owned slices; they do not close their retained lanes.
The four [review paths](DELIVERY-FORECAST.md#review-paths) have distinct prerequisites. Segmented
continuation still requires reviewed public contract/format incorporation before dependent writers.
History host/editor contracts, actual adapter qualification and mounted author journeys remain
separate from core/isolated UI evidence. A new candidate head requires its own applicable assessment
and checks; this page is not a transferable pass or release approval.
