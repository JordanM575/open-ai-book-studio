# Product film storyboard

**Version:** draft 1, 2026-10-26
**Master:** 1920×1080, 30 fps, 16:9. App captures at 1440×900, 2× where possible.
**Motion:** HTML/CSS plates using the design tokens; capture through Playwright. Real UI is never
redrawn.

## Shot list

### S01 — The problem (0:00–0:16)

- **Picture:** split screen. Left: a generic chat window with a paragraph. Right: a Finder folder with
  `book.json`, `chapters/`, `images/`. A cursor selects text in the folder and pastes it into the chat;
  the file dims.
- **Capture/motion:** motion plate with two real screenshots (a fixture folder and the studio chat
  panel, blurred names). Slow push-in; copy/paste cursor path; no fake AI particles.
- **Audio:** low room tone; a soft keystroke on paste.
- **Text:** “The book is somewhere else.” → “Copy. Paste. Hope.”
- **Benefit:** the problem is custody, not generation.

### S02 — Reveal (0:16–0:26)

- **Picture:** the app window rises from the ambient wash; the library grid settles; the manuscript
  sheet becomes the only solid surface.
- **Capture:** real library view at 1440×900 on the fixture library.
- **Motion:** 1.04× scale to 1.0, glass highlights, one soft chime.
- **Text:** “AI Book Studio” then the tagline.
- **Benefit:** this is a studio, not a chat.

### S03 — Ownership (0:26–0:40)

- **Picture:** open a book; cut to Finder with the same folder open; highlight `book.json`,
  `chapters/0001-…md`, `images.json`.
- **Capture:** real app + Finder, same fixture. Use a clean path (`~/Movies/AI Book Studio Demo`) and
  no personal folders.
- **Motion:** file-tree labels slide in; “Markdown + JSON” label; no fake code.
- **Text:** “A folder, not an account.”
- **Benefit:** the author can leave with the book.

### S04 — Planning (0:40–0:56)

- **Picture:** workspace, then Story Bible: outline, cast, memories, arc. Return to the manuscript.
- **Capture:** real Story Bible on the fixture book; scroll to the cast and memories.
- **Motion:** a thin connector line from the chapter to the Story Bible; chapter card lifts.
- **Text:** “Plan and write in one place.”
- **Benefit:** the agent has context because the book has context.

### S05 — Agency (0:56–1:10)

- **Picture:** chat prompt “Draft the next scene, keep the lighthouse keeper’s voice.” Tool lines appear:
  `read_story_bible`, `read_chapter`, `append_to_chapter`. The manuscript changes; word count moves.
- **Capture:** a real recorded turn on the fixture book, or a recorded live Meta turn with secrets
  removed. Trim dead time; keep one tool start/end pair.
- **Motion:** cursor highlight; tool lines type on; a subtle highlight over the new prose.
- **Text:** “The agent edits the book, not a chat transcript.”
- **Benefit:** the model has hands.

### S06 — Trust (1:10–1:22)

- **Picture:** save status “Saving…” → “Saved”; undo checkpoint; small diff overlay on the new lines.
- **Capture:** real save status and undo. Do not stage a fake conflict.
- **Motion:** status dot pulse; checkpoint card; diff highlight sweeps once.
- **Text:** “Checked saves. Undo checkpoints.”
- **Benefit:** the agent is powerful because it is reversible.

### S07 — Voice (1:22–1:36)

- **Picture:** microphone button, recording timer, waveform, transcript inserted at the caret.
- **Capture:** real dictation on the fixture book, or a recorded session with the audio replaced by a
  clean narration line. The UI must show the real states.
- **Motion:** waveform bars; caret blink; transcript types in.
- **Text:** “Dictate with Muse Voice Transcribe.”
- **Benefit:** the author can write without typing.

### S08 — Background (1:36–1:52)

- **Picture:** tick “Background”, send, close the window. A native notification slides in; click it;
  the window reopens on the finished thread.
- **Capture:** real background turn and notification on macOS. If the screen recorder cannot capture
  notifications, use a screen recording of Notification Center with the same copy and disclose it as a
  UI plate.
- **Motion:** timeline bar “window closed → agent working → ready”; notification card.
- **Text:** “It keeps working after you close the window.”
- **Benefit:** the agent is a colleague, not a tab.

### S09 — Illustration (1:52–2:08)

- **Picture:** Illustration dialog: prompt, shape, “Generate · $0.01”, generating state, image appears;
  attach; chapter shows the image.
- **Capture:** real Muse Image generation if the key is available; otherwise a recorded real response
  from the event, clearly labelled in the asset manifest. The dialog and save are real.
- **Motion:** estimate chip; image reveal; prompt caption.
- **Text:** “Muse Image · $0.01 per image.”
- **Benefit:** the book can look like the book in the author’s head.

### S10 — Cutout (2:08–2:24)

- **Picture:** Cutout section: “the lighthouse keeper”, Find objects, match boxes/ids, Save cutout,
  transparent PNG beside the source.
- **Capture:** real SAM 3.1 response on the generated illustration. Show the match picker and the
  transparent result on a checkerboard.
- **Motion:** mask outline; checkerboard reveal; “transparent PNG” label.
- **Text:** “SAM 3.1 cutouts, saved as files.”
- **Benefit:** an illustration becomes a character asset.

### S11 — Interop (2:24–2:40)

- **Picture:** terminal `bookwriter books`, a book id and chapter id; `bookwriter mcp`; an MCP client
  `tools/list`; cut back to the same book in the studio.
- **Capture:** real CLI and MCP against the open desktop app. Use a large font and a clean prompt.
- **Motion:** terminal typing at human speed; token/loopback diagram (local only, crossed-out cloud).
- **Text:** “CLI + MCP for other agents. No second copy.”
- **Benefit:** the book is a platform, not a silo.

### S12 — Close (2:40–3:00)

- **Picture:** DOCX export opens with the illustration; Finder shows the folder; slow pull-back to the
  manuscript sheet; close card.
- **Capture:** real export and Finder; final card is a motion plate.
- **Motion:** page turn; folder tree; tagline fades in.
- **Text:** “Your book. Your files. Your agent.”
- **Benefit:** ownership is the last image.

## Transitions and rhythm

- Hard cuts inside a feature sequence; one soft dissolve between chapters of the story.
- No transition longer than 300 ms.
- On-screen text stays at least 1.5 s; the tagline stays 3 s.
- Music ducks under narration; one beat lands on the app reveal and one on the close.

## Capture checklist

- [ ] Fixture library only; no author data.
- [ ] Notifications from other apps off; menu bar out of frame.
- [ ] Cursor visible, deliberate, no accidental clicks.
- [ ] App at 1440×900; 2× capture; 30 fps timeline.
- [ ] Every state is real: save, conflict, background, notification, generate, cutout, CLI, MCP.
- [ ] Exact commit and test count recorded in `assets.md`.
