# Tasks: submission package

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — Sample and packet

- [x] T001 Commit `samples/the-salt-road` with the original two-chapter book, Story Bible, illustration
  and cutout; no `.studio/`, `library.json` or personal data. Add `samples/README.md` with provenance
  and the public-domain dedication.
- [x] T002 Write `hackathon/SUBMISSION.md`: track/theme/solo entrant, product statement, event-built
  disclosure, Meta models, verification evidence and the form fields still to fill.
- [x] T003 Map the judging rubric to the demo: impact, Meta tooling, technical depth and demo evidence.

## Phase 2 — Checks

- [x] T004 Add `scripts/submission-check.ts` and `bun run submission:check`: branch/tree, required
  files, forbidden tracked paths, secret patterns, sample integrity and the clean-clone reminder.
- [x] T005 Add a test for the sample: JSON parses, chapters exist, images match the manifest, no
  absolute path or key-like string, and the cutout points at the illustration.
- [x] T006 Add the sample and the check to the README/quickstart and the hackathon plan.

## Phase 3 — Publication and evidence

- [ ] T007 Run `bun run submission:check`, `bun run verify` and `bun run smoke`; record the commit and
  test count in `hackathon/SUBMISSION.md`.
- [ ] T008 Clean clone the submitted revision and repeat the install/verify/smoke pass; record the
  result.
- [ ] T009 Make the repository public only after the scan passes; fill the repository link and the
  private-window check.
- [ ] T010 Fill the video links, thumbnails and captions; check both from a private window.
- [ ] T011 Submit the form before November 4, 9:00 PM ET; keep the confirmation and the submitted
  commit hash in the packet.

## Dependencies

- T001–T006 are unblocked.
- T007–T010 depend on the film and the Gitea/GitHub visibility decision.
- T011 is the deadline gate.
