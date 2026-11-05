# Plan: Android product target

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

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
and 011/022 provider consent. Keep every unverified capability disabled and explain why. 038 remains
reserved to the voice-options candidate; do not recreate it here.

## Verification and release

Use temporary synthetic libraries and mocked provider/credential bridges for contract tests.
Then verify lifecycle, grants, conflicts and recovery on the approved emulator/device matrix. Device
work uses the harness device tools and explicit target selection; no paid services, signing secrets
or store actions are implied by this plan. Record exact build hash, OS/device, journeys and failures.
Real-device release/signing needs U-040-04 and owner approval; desktop sign-off does not wait for it.

Check accessibility and responsive states, integrated typecheck/tests/build, refusal before side
effects, secret redaction, file recovery/export and install/update preservation. Publish store links
only after an actual approved release. Distinguish emulator, real-device and distribution evidence.
