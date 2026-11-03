# Plan: integration health

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Shape

Three pure derivations in `packages/core`, one notice component in `packages/ui`, and the existing
settings surfaces read them. Nothing here writes to a folder or calls a network service.

- `packages/core/src/sync/health.ts` (new): `locationHealth(files, journal)` returns the state, count and
  action for a location. It consumes the detector's file observations from 016 T001–T003, so it adds
  no second scan.
- `packages/core/src/providers/status.ts` (new): maps a connection's last check to the five states,
  with redaction through the existing `redact()`.
- `packages/ui/src/notice.tsx`: the one warning component, extended with severity, icon and actions.
  Today's `Notice` is the starting point.

## Decisions

- The location states are derived, not stored (FR-001). A stored state would need its own sync.
- Storage support follows 016 and D-122, which is still `Proposed`. This spec states the folder-based
  assumption from D-122's recommendation and does not depend on the API decision.
- Severity copy is the only place the studio says "danger". The store and the save path do not change.

## Provider and voice status source assessment (2026-11-02)

No passive connection record currently contains a last-check result. `ConnectionSummary` exposes
`lastUsedAt`, which is not evidence that a provider is healthy and must not be relabeled as a check
time. Settings reads the connection list without contacting providers. The existing Test button is
an explicit network request: success returns a message, while IPC failures preserve a normalized
provider error code. A future UI can record a volatile timestamp only after that author-requested
check; Settings opening must not call it automatically. The current UI's `must()` helper discards the
structured error code, so status mapping needs an intentional result-handling path.

Voice availability is separately derivable without a probe: `SpeechService.connections()` and
`voice.speakers()` inspect configured connection capability and credential metadata, but do not
verify the provider endpoint or supply a last-check time. Calling text-to-speech to test health would
send author text and is not an acceptable health probe. T006 is done under recorded D-161: the check
time is volatile explicit-test status only, and voice carries no check time. The Test handler reads
the raw result envelope so failures keep their structured provider code (must() would discard it);
unknown codes narrow to "unknown", and failures render through `providerStatus()` so secrets stay
redacted. Covered by `apps/desktop/tests/settings-status.test.tsx`.

## Files

- `packages/core/src/sync/health.ts`, `packages/core/tests/sync-health.test.ts`
- `packages/core/src/providers/status.ts`, `packages/core/tests/provider-status.test.ts`
- `packages/ui/src/notice.tsx` and its story-free test in the desktop renderer tests
- Settings and library list (existing components in `packages/app`)
