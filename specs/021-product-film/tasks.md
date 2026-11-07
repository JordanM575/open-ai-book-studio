# Tasks: product film and voiceover

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

**Status, November 7, 2026:** the original submitted master and newer author-supplied demo link exist.
Later captures, Weston narration and film assemblies supersede the old “not started/no voice chosen”
notes. Unchecked rows below retain their full deliverable/acceptance scope; publication of a URL does
not prove every caption, short cut, licence, timing or privacy check. Reconcile exact artifacts before
closing them, with the spec's later author direction taking precedence over the original storyboard.

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
  toggle, notification, illustration dialog, CLI, MCP and DOCX export. SAM/cutout is superseded by
  D-158. Captures exist; map the delivered shots to their build/source before closing the full row.
- [ ] T006 Capture the Finder/file-tree proof and the export result. Reconcile existing captures and
  their privacy checks; any remaining capture uses synthetic books and a throwaway profile.

## Phase 3 — Motion and voice

- [x] T007 Build the HTML/CSS motion plates with the design tokens and capture them frame-exactly
  through Playwright. `video/motion/index.html` has eight scenes; `render.mjs` renders preview stills
  or deterministic PNG sequences; previews were checked at 1920×1080.
- [ ] T008 Record the narration or generate the licensed synthetic track; transcribe it with Muse
  Voice Transcribe and lock the timing. Weston was selected and generated narration exists. Match
  the final cut's transcript/timing/disclosure before closing; no fresh paid transcription is implied.
- [ ] T009 Licence and credit the music; mix to −14 LUFS / −1 dBTP. Village Consort and the Creative
  Commons sound pack were selected; reconcile their exact credits/licences and measured final mix.

## Phase 4 — Edit and deliver

- [ ] T010 Edit the 3:00 master, 0:30 cut and 0:15 vertical; add burned-in captions and export SRT.
  The original 2:59 submission and newer demo exist; complete the deliverable inventory for short/
  vertical/silent cuts and caption files. The original repository tooling is described below.
  `video/edit/film.json` is the edit list. `node video/edit/assemble.mjs` builds the master and its
  SRT, and `--cut30` builds the 0:30 cut; each shows a footage-pending slate until its clip exists.
  `--check` compares the edit list with the script, fails over 3:00 and measures loudness. The
  assembler plays the strip's own sound under the narration (`"sound": 1`) and normalizes the master
  and the 0:30 cut to −14 LUFS / −1 dBTP. Still to do: the 0:15 vertical, the burned-in captions and
  the music (T009).
- [ ] T011 Run the truth, privacy, silent and phone checks; record the commit and test count in
  `video/assets.md`.
- [ ] T012 Upload the master and short cut, check both links in a private window, and attach them to
  the submission.
  The original master was submitted; the newer author-provided master link is in the README.
  Short-cut delivery and the complete playback/link record remain open. This row authorizes no new upload.

## Dependencies

- T004's historical cutout fixture does not establish a current SAM capability; 020 is superseded.
- T008's remaining timing work should reuse existing narration/evidence; any paid call needs explicit scope.
- T012 now needs remaining-deliverable reconciliation and playback evidence; the original form is submitted.
