# Tasks: provider compatibility and Contributor

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — Compatibility seam

- [x] T001 Add `packages/core/src/providers/compatibility.ts`: Muse Spark 1.3 Contributor and Standard
  presets, cached price, training flag, reasoning levels, contributor helpers and the warning copy.
- [x] T002 Extend `ModelInfo` and `ProviderService.models` to enrich provider catalogues without
  overwriting reported facts. Add core tests for the preset merge and non-Meta providers.
- [x] T003 Refactor `transport.ts` to a `Record<ProviderId, Adapter>` registry with one `modelFor`
  entry point. Add a capability test that every provider has an adapter.

## Phase 2 — Consent

- [x] T004 Add `allowContributorTraining` to the book schema, default `false`, and refuse a contributor
  model in `AgentRuntime.start` before any credential or request.
- [x] T005 Add the Contributor warning, prices, reasoning note and consent checkbox to the model picker;
  disable Use until consent; persist the flag in book and per-turn modes.
- [x] T006 Add tests: runtime refusal, picker consent persistence and the Standard preset with no training warning in the core test.

## Phase 3 — Live test and docs

- [x] T007 Add the Contributor facts and privacy note to `docs/ARCHITECTURE.md`, D-138/D-139 to
  `docs/DECISIONS.md`, the hackathon plan and the changelog.
- [ ] T008 Opt-in live run on the fixture book with `muse-spark-1.3-contributor`: record the exact
  model, prices, usage, consent flag and that no author data was used. Blocked without a Meta key.

## Dependencies

- T001–T006 need no live key.
- T008 needs Meta access to the Contributor model; it is never run on the author's library.
- A network compatibility endpoint is deferred by D-139.
