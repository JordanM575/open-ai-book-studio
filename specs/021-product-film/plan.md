# Plan: product film and voiceover

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Current delivery checkpoint — November 7, 2026

The original demo was submitted and a newer author-supplied upload is linked from the README.
Later device-film captures, Weston narration and assemblies exist. The repository pipeline below
records the original production approach, not proof that a published upload was made by that exact
assembler or has passed all its checks. Follow the spec's current author direction when reconciling it.

Next, inventory each delivered master/short/vertical, caption/transcript and source version; map it to
its actual footage, narration and music credits. Match claims and provenance to the recorded build,
then review the exact upload for timing, audible narration, privacy and captions. Preserve source
clips and prior review evidence. Do not regenerate audio or commission a paid capture merely to
fill an old unchecked row when the needed asset already exists. A further upload needs author approval.

## Production shape

```
video/
  README.md            how to capture, narrate, edit and check
  script.md            locked timed narration and on-screen text
  storyboard.md        shot list, UI state, motion, capture method
  assets.md            music, voice, fonts, icons and licences
  fixture/             deterministic film fixture generator notes
  motion/              HTML/CSS plates and the Playwright frame renderer
  source/              project files and capture scripts
  renders/             generated masters and cuts (not committed)
```

The film is assembled from three layers:

1. **Real app captures** at 1440×900, 2× scale, on a fixture library.
2. **Motion plates** built as HTML/CSS scenes with the studio tokens, captured frame-exactly through
   Playwright. No external motion tool is required.
3. **Voice and music** on one timeline, with captions derived from the final narration.

## Capture

Use the existing hidden-window and capture harness where possible. Record the real UI, not a mock:

- A fixture library with one short book, a Story Bible, two chapters and a generated illustration.
- A fake Meta connection is not enough for a surface that needs a live call; the film may use a
  recorded real call from the event with the key and account data removed.
- Cursor: hardware cursor, click highlights, slow deliberate moves. Zooms are 1.2–1.6×.
- UI states to capture: library, workspace, Story Bible, agent tool call, diff/checkpoint, save
   status, dictation, background toggle, notification, illustration dialog,
   CLI `bookwriter books`, MCP `tools/list`, DOCX export, Finder. The old SAM/cutout beat is superseded.

Screen recording on macOS: QuickTime or `screencapture -v` at 60 fps; crop to the window; keep the
menu bar out. If the hidden harness is used, render at a fixed window size and capture frames rather
than the screen.

## Motion plates

Build each plate as a small HTML page with the tokens from `packages/ui/src/styles`. Capture with
Playwright at 1920×1080, 30 fps, using a deterministic timeline (no CSS `Date.now()` or random). The
plates are:

- title/problem split: chat window vs folder;
- file-tree reveal and “Markdown + JSON” labels;
- chapter card and word-count ticker;
- “checked save” and “undo checkpoint” callouts;
- “after the window closes” timeline;
- Muse Image illustration strip (the old SAM/cutout plate is historical, not a current feature claim);
- CLI/MCP diagram with a loopback token, no cloud;
- close card with the tagline.

All plates use the same type scale, one accent and no gradient beyond the ambient wash. Motion is
short, purposeful and reduced-motion friendly.

The implementation is [`video/motion/index.html`](../../video/motion/index.html). It exposes
`window.renderAt(ms)` so every reveal is deterministic; `render.mjs` drives Playwright at 1920×1080 and
writes either preview stills or a 30 fps PNG sequence to `video/renders/motion/`. Scenes: problem,
files, trust, background, visuals, voice, interop and close.

## Voice

1. Lock `script.md`.
2. Reuse the selected Weston narration where it matches the approved script; record the exact source
   and synthetic-voice disclosure. The earlier author-voice preference is superseded.
3. Transcribe the final track with Muse Voice Transcribe (spec 017 service or the event console) to
   produce a timing transcript.
4. Edit for pace and breath; target 145–160 wpm.
5. Verify the selected synthetic track's provenance, permitted use and disclosure for the exact cut.
6. Mix narration, music and light UI sound; target −14 LUFS and −1 dBTP.

## Edit and delivery

- Master timeline: 1920×1080, 30 fps, H.264, AAC 48 kHz, faststart.
- 30-second cut: problem → agent → voice → background → close.
- 15-second vertical: 1080×1920, hook → one agent shot → tagline.
- SRT from the final mix; burn in for the silent cut.
- QA: watch muted, watch on a phone, check every claim against the build, check no personal data.

## Verification

- `bun run typecheck`, `bun test`, `bun run build`, `bun run build:web` before the final capture.
- Record the exact commit and test count in the asset manifest.
- Play the master and short cut from a private browser window and from the submission page.
- Confirm the repository and video links are public before submitting.
