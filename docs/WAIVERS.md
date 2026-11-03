# Waiver ledger

A waiver lets a required gate stay red while a fix lands, but never silently: every waived
gate names its reason, its owner and its expiry. `bun run waiver:check` enforces the dates;
an expired or malformed row fails the gate. The release job (spec 012 T023) consults this
ledger: a failing gate with a live waiver may proceed, and the waiver is printed in the
release log and notes (FR-033).

## Process

- Waive by adding a row below. The gate keeps failing loudly; the row records that a person
  accepted the risk until a date.
- Every row needs the gated check, a reason that names the failure, an owner (a person, not
  a team), the date it was waived, and an expiry date no more than 30 days out. The gate column
  names a `bun run verify` gate (`build:info`, `lint`, `typecheck`, `quarantine:check`,
  `waiver:check`, `test`, `build`, `build:web`) or a release end-to-end stage (`smoke`,
  `web-smoke`, `smoke:packaged`, `artifact-scan`) so the release script can match failures.
- When the expiry date passes, the gate fails until the row is fixed or removed. Extending
  a date is allowed once, with a new reason, and shows in the diff like any other change.
- One row per gate: a second live row for the same gate is malformed.

## Ledger

| ID | Gate | Reason | Owner | Waived | Expires |
|----|------|--------|-------|--------|---------|
