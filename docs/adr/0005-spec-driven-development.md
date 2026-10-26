# 0005 — Spec-driven development

- **Status:** Accepted (2026-10-24)

## Context

The previous repository accumulated twelve completed spec-kit features plus a large amount of
research (audits, flow maps, follow-up lists) that was difficult to relate back to code. New work
started from conversation, so intent and acceptance criteria were lost.

## Decision

Every feature begins as a written spec in `specs/NNN-name/`:

- `spec.md` — why, who, user stories, numbered functional requirements, acceptance criteria, and
  explicit non-goals. No implementation detail.
- `plan.md` — the technical approach, files touched, risks, migrations, test strategy.
- `tasks.md` — ordered, checkable tasks mapped to requirements.

Work is implemented against `tasks.md`; anything discovered along the way is appended as a task
rather than done silently. The spec set is committed with the code. Architecture-level choices go to
`docs/adr/` with Status, Context, Decision, Consequences, and rejected alternatives. The file format
is normative in `docs/FORMAT.md`; changing it requires updating that document in the same commit.

Retroactive specs are allowed and expected: `001-foundation` documents what was built before this
process existed, so the record starts complete rather than starting mid-stream.

## Consequences

Positive: reviewable intent; a durable answer to "why is it like this"; tasks give an honest measure
of completion; future agents can resume without archaeology.

Negative: writing a spec costs time and can lag behind exploratory code; small fixes must resist the
temptation to grow a spec. We accept a lightweight spec for small features rather than skipping it.

Rejected alternatives: issues only (no design memory, poor for multi-step features); design docs per
area (better for architecture, worse for change tracking); nothing (the previous repository).
