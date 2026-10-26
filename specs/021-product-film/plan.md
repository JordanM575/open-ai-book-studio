# Plan: product film and voiceover

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Production shape

```
video/
  README.md            how to capture, narrate, edit and check
  script.md            locked timed narration and on-screen text
  storyboard.md        shot list, UI state, motion, capture method
  assets.md            music, voice, fonts, icons and licences
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
  status, dictation, background toggle, notification, illustration dialog, SAM match picker, cutout
  in the chapter, CLI `bookwriter books`, MCP `tools/list`, DOCX export, Finder.

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
- “Muse Image → SAM 3.1 → transparent PNG” strip;
- CLI/MCP diagram with a loopback token, no cloud;
- close card with the tagline.

All plates use the same type scale, one accent and no gradient beyond the ambient wash. Motion is
short, purposeful and reduced-motion friendly.

## Voice

1. Lock `script.md`.
2. Record the author’s voice in a quiet room, 48 kHz/24-bit WAV, one line per take.
3. Transcribe the final track with Muse Voice Transcribe (spec 017 service or the event console) to
   produce a timing transcript.
4. Edit for pace and breath; target 145–160 wpm.
5. If a licensed synthetic voice is chosen, keep the same script and add the disclosure note.
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
