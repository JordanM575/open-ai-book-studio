# Tasks: SAM 3.1 cutouts

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — Parser and contract

- [x] T001 Add `packages/core/src/images/segmentation.ts` for the serializable match/result types and
  prompt validation. Use the official `@meta-sam/parser` in the desktop service for the token grammar,
  base85 and one-bit/lossless masks; add a zero-match test and malformed-prompt coverage.
- [x] T002 Add `apps/desktop/src/main/segmentation.ts`: Meta connection, `/v1/responses` with
  `sam-3.1`, data-URL source image, timeout and normalized errors. Tests use a mocked fetch.

## Phase 2 — IPC and cutout

- [x] T003 Add `segmentation:segment` and `image:save-cutout` IPC channels with Zod validation, source
  ownership checks, size limits and preload types.
- [x] T004 Add `packages/app/src/lib/cutout.ts`: load the source, scale the binary mask, set alpha and
  export a PNG blob. `cutout.test.ts` covers alpha clearing, bounds and source immutability.

## Phase 3 — Interface

- [x] T005 Add Cutout mode to `IllustrationDialog`: noun-phrase prompt, segmented boxes, object id and
  confidence, match picker, preview and Save cutout. Show zero-match, source-missing, refusal and
  provider-error states.
- [x] T006 Attach the saved cutout to a character when one is selected; otherwise save it as a
  character image with `cutoutOf` and let the author attach it later.

## Phase 4 — Evidence and docs

- [x] T007 Add the format and provenance fields to `docs/FORMAT.md`, the SAM path to
  `docs/ARCHITECTURE.md`, D-132/D-133 to `docs/DECISIONS.md`, the spec to `specs/README.md` and the
  changelog entry. `THIRD_PARTY_NOTICES.md` records the SAM License dependency; the full docs pass
  still needs the final packaging check.
- [ ] T008 Manual pass with a Meta key: segment a generated illustration, choose a match, save the
  transparent PNG and reopen the book. Record it in `docs/research/sam-cutout-2026-10-26.md`.

## Dependencies

- T001–T005 need no live key.
- T008 needs Meta access to `sam-3.1`.
- The image store and illustration panel from spec 019 must exist first.
