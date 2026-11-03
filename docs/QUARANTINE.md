# Quarantine ledger

A quarantined test keeps failing for a known reason while a fix lands. Quarantine is an
extreme measure with an expiry date, never a parking lot and never a retry: a failing
test MUST NOT be fixed by adding a retry (FR-026), and no entry stays past its removal
date. `bun run quarantine:check` enforces the dates; the suite treats the ledger as part
of the gate.

## Process

- Quarantine by marking the test `test.skip` with a comment naming the ledger ID, and add
  a row below. The skip keeps the suite green; the row keeps the debt visible.
- Every row needs an owner (a person, not a team), a reason that names the failure, the
  date it was quarantined, and a removal date no more than 30 days out.
- Review the ledger weekly (SC-004). Fix the test, delete the row, unskip the test.
- When the removal date passes, the gate fails until the row is fixed or removed. Extending
  a date is allowed once, with a new reason, and shows in the diff like any other change.

## Ledger

| ID | Test | Owner | Reason | Quarantined | Remove by |
|----|------|-------|--------|-------------|-----------|
