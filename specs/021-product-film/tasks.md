# Tasks: product film and voiceover

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

## Phase 1 — Story and brand

- [x] T001 Record the competitor/brand review in `docs/research/branding-2026-10-26.md` and add the
  positioning paragraph to `docs/DESIGN.md`. Done in this slice.
- [x] T002 Lock `video/script.md` against the actual build: timed narration, on-screen text and the
  benefit line for each shot.
- [x] T003 Lock `video/storyboard.md`: every UI state, capture method, motion plate and transition.

## Phase 2 — Capture

- [x] T004 Build a fixture library for the film: one short original book, Story Bible, two chapters,
  a generated illustration and a cutout. No personal data. `scripts/film-fixture.ts` builds
  `video/fixture/library` through the real `Library`/`ImageStore`, with deterministic PNGs; the test
  covers the book, cast, chapters, illustration, cutout and manifest.
- [ ] T005 Record the library, workspace, Story Bible, agent turn, save status, dictation, background
  toggle, notification, illustration dialog, SAM match picker, cutout, CLI, MCP and DOCX export.
  Blocked on a manual screen-recording session; the fixture and hidden capture harness are ready.
- [ ] T006 Capture the Finder/file-tree proof and the export result. Blocked on the same capture
  session; it uses the fixture folder and a throwaway profile.

## Phase 3 — Motion and voice

- [x] T007 Build the HTML/CSS motion plates with the design tokens and capture them frame-exactly
  through Playwright. `video/motion/index.html` has eight scenes; `render.mjs` renders preview stills
  or deterministic PNG sequences; previews were checked at 1920×1080.
- [ ] T008 Record the narration or generate the licensed synthetic track; transcribe it with Muse
  Voice Transcribe and lock the timing.
- [ ] T009 Licence and credit the music; mix to −14 LUFS / −1 dBTP.

## Phase 4 — Edit and deliver

- [ ] T010 Edit the 3:00 master, 0:30 cut and 0:15 vertical; add burned-in captions and export SRT.
- [ ] T011 Run the truth, privacy, silent and phone checks; record the commit and test count in
  `video/assets.md`.
- [ ] T012 Upload the master and short cut, check both links in a private window, and attach them to
  the submission.

## Dependencies

- T004 needs the image/SAM surfaces from 019/020.
- T008 needs a quiet recording space or a licensed voice; Muse Voice Transcribe needs a Meta key.
- T012 waits on the public repository and the submission form.
