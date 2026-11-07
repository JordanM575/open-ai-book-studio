# Plan: Android product target

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

**Status:** Draft / Planned. Expanded November 7, 2026; shell, storage and target choices remain open.

## Approach

Reuse `packages/core` storage/capability contracts, `packages/app` shared views and `apps/mobile`
only after U-040-01 establishes shell ownership. Keep Android-specific storage, lifecycle, protected
credentials, picker and permission bridges behind validated platform adapters. Confirm module paths
after the shell decision; this draft does not choose a plugin, SDK or provider transport.

U-040-02 must prove the required save contract on Android document/storage providers; do not assume
desktop rename semantics. Where the contract cannot be met, refuse writes and describe the limit.
Do not create a second Library writer, renderer filesystem path or automatic cloud-sync mechanism.
Any changed format needs docs/FORMAT.md, an ADR and migration/conflict tests before implementation.

Build a core editor/storage slice before enabling optional voice. Reuse 029/035 import/export gates
and 011/022 provider consent. Keep every unverified capability disabled and explain why. Integrated
038 owns desktop voice preferences; Android must prove its own capability/credential boundary before
reusing that contract.

## Decision work before implementation

| Question / task | Required decision packet | Evidence to collect before acceptance |
| --- | --- | --- |
| U-040-01 / T001–T002 | Shell ownership, shared/native responsibilities, supported API levels and device classes | Compare feasible shells against current 010/013/014 contracts; list build, accessibility and plugin constraints. An iOS choice or responsive page is not Android support. |
| U-040-02 / T003–T004 | Library location, picker grants, publication primitive, conflict/trash and uninstall/export lifecycle | Synthetic provider probes for overwrite/rename, interruption at each write phase, permission revocation, stale second-writer state and restart. Explicitly document any check/replace race; do not promise desktop atomicity from an API name. |
| U-040-03 / T005 | Protected-secret boundary and per-capability provider/voice matrix | Unavailable protection refuses persistence; mock request/log/export inspection proves redaction and unsupported actions refuse before capture. Document permission and transport ownership before choosing a plugin. |
| U-040-04 / T007 | Signing/release owner, update/rollback matrix and approved distribution route | Identify required access, artifact identity and preservation tests. Keep emulator, physical-device and store evidence as separate entries. |

Research outcomes belong in `docs/DECISIONS.md` and the architecture ADR after acceptance. No SDK,
storage plugin, minimum API number, device matrix or cloud-sync service is selected by this plan.

## Delivery checkpoints

1. **Capability inventory (T001):** give every feature a supported, refused or unverified entry and
   identify the storage/editor subset to prove first. Shared UI ownership does not establish native I/O.
2. **Editor/storage slice (T002–T004):** after shell/storage acceptance, create, edit, save, reopen and
   export an isolated ordinary-file library. Run a second fixture writer and revoke permissions during
   save; retain the last complete chapter and recoverable text with truthful status. No provider is
   required to prove this slice.
3. **Platform services (T005):** add only accepted credential/provider capabilities; optional voice
   stays disabled until its pre-capture checks pass. Keep denied/unavailable paths keyboard reachable
   and explicit rather than hiding a capability failure behind an empty result.
4. **Lifecycle and usability (T006/T008):** exercise process death before/after publication, reopen,
   permission loss, background/return, rotation and accessibility on the approved emulator matrix.
   Record build hash, target and actual recovery outcome; test exported bytes independently.
5. **Device/release acceptance (T007):** obtain the accepted release scope and access before physical
   device installation, signing or publication. Verify upgrade/profile/library preservation and
   incompatible-schema refusal on that exact artifact before adding an available release link.

## Verification and release

Use temporary synthetic libraries and mocked provider/credential bridges for contract tests.
Then verify lifecycle, grants, conflicts and recovery on the approved emulator/device matrix. Device
work uses the harness device tools and explicit target selection; no paid services, signing secrets
or store actions are implied by this plan. Record exact build hash, OS/device, journeys and failures.
Real-device release/signing needs U-040-04 and owner approval; desktop sign-off does not wait for it.

Check accessibility and responsive states, integrated typecheck/tests/build, refusal before side
effects, secret redaction, file recovery/export and install/update preservation. Publish store links
only after an actual approved release. Distinguish emulator, real-device and distribution evidence.
