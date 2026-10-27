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

## Files

- `packages/core/src/sync/health.ts`, `packages/core/tests/sync-health.test.ts`
- `packages/core/src/providers/status.ts`, `packages/core/tests/provider-status.test.ts`
- `packages/ui/src/notice.tsx` and its story-free test in the desktop renderer tests
- Settings and library list (existing components in `packages/app`)
