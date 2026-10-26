# Plan: submission package

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Files

```
samples/the-salt-road/        committed sample library (books/, original text, images)
samples/README.md             provenance and licence of the sample
hackathon/SUBMISSION.md       the packet: links, track, disclosure, demo runbook, judge map
scripts/submission-check.ts   local readiness checks (tree, files, scan, clean-clone reminder)
```

## Sample library

The sample is built by `scripts/film-fixture.ts` and then committed without `.studio/` or
`library.json`. The app recreates the device identity and derived catalog when a judge opens it. The
text is original and the images are deterministic fixture renders; the sample is dedicated to the
public domain in `samples/README.md`.

The sample must remain openable by the current `book.json` schema. A schema change after the sample is
committed requires regenerating the sample and updating the manifest hashes.

## Submission check

`bun run submission:check` verifies the local packet without touching the network:

- branch `meta-hackathon`, clean tree;
- required files: `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, README, toolkit docs, film script and
  storyboard, sample library;
- tracked paths that never ship: `.env`, `credentials.json`, `userData/`, `release/`, real-library
  fixtures;
- a secret/vendor-key pattern scan over tracked text files;
- the sample book, chapters, images and manifest parse and reference existing files;
- a reminder to run `bun run verify`, `bun run smoke` and the public-link check from a clean clone.

The check fails closed with a non-zero exit and a short list of problems. It does not publish anything.

## Packet

`hackathon/SUBMISSION.md` is the working copy of the form and the demo runbook:

1. Project name, track, theme, solo entrant.
2. Repository and video links (filled after publication).
3. One-paragraph product statement.
4. What existed before the event and what was built during it.
5. Meta models and partner services used.
6. Test/verification evidence at the submitted commit.
7. 10-minute live-demo runbook and the offline fallback.

## Verification

- `bun run typecheck`, `bun test`, `bun run build`, `bun run build:web`.
- `bun run submission:check`.
- Clean clone: `bun install && bun run verify && bun run smoke`.
- Private-window link check for the repository, master film and 0:30 cut.
- Manual form pass before **November 4, 9:00 PM ET**.
