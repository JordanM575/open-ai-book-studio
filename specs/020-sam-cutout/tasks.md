# Tasks: SAM 3.1 cutouts

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — Parser and contract

- [ ] T001 Add `packages/core/src/images/segmentation.ts`: prompt validation, tokenizer for frame,
  object id, box and mask records, base85 decoding, one-bit and lossless mask rasters, confidence and
  zero-match results. Add fixtures for one, three and zero matches plus malformed payloads.
- [ ] T002 Add `apps/desktop/src/main/segmentation.ts`: Meta connection, `/v1/responses` with
  `sam-3.1`, data-URL source image, timeout and normalized errors. Tests use a mocked fetch.

## Phase 2 — IPC and cutout

- [ ] T003 Add `segmentation:segment` and `image:save-cutout` IPC channels with Zod validation, source
  ownership checks, size limits and preload types.
- [ ] T004 Add `packages/app/src/lib/cutout.ts`: load the source, scale the binary mask, set alpha and
  export a PNG blob. Unit-test the compositor with a small synthetic image.

## Phase 3 — Interface

- [ ] T005 Add Cutout mode to `IllustrationDialog`: noun-phrase prompt, segmented boxes, object id and
  confidence, match picker, preview and Save cutout. Show zero-match, source-missing, refusal and
  provider-error states.
- [ ] T006 Attach the saved cutout to a character when one is selected; otherwise save it as a
  character image with `cutoutOf` and let the author attach it later.

## Phase 4 — Evidence and docs

- [ ] T007 Add the format and provenance fields to `docs/FORMAT.md`, the SAM path to
  `docs/ARCHITECTURE.md`, D-132/D-133 to `docs/DECISIONS.md`, the spec to `specs/README.md` and the
  changelog entry.
- [ ] T008 Manual pass with a Meta key: segment a generated illustration, choose a match, save the
  transparent PNG and reopen the book. Record it in `docs/research/sam-cutout-2026-10-26.md`.

## Dependencies

- T001–T005 need no live key.
- T008 needs Meta access to `sam-3.1`.
- The image store and illustration panel from spec 019 must exist first.
