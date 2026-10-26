# Motion plates

The film's motion graphics are HTML/CSS plates rendered frame-exactly with Playwright. They use the
studio tokens and are composited over the real app captures during the edit.

```bash
# One still per scene, with the ambient wash (easy to inspect)
node video/motion/render.mjs --preview --ambient

# One transparent still per scene for compositing
node video/motion/render.mjs --preview --transparent

# Three seconds at 30 fps for every scene, transparent PNG sequence
node video/motion/render.mjs --all

# One scene, with an MP4 preview
node video/motion/render.mjs --all --scene=background --ambient --mp4
```

Output goes to `video/renders/motion/<scene>/` and is ignored by git.

## Scenes

| Scene | Purpose |
| --- | --- |
| `problem` | Chat vs. folder; the copy/paste problem |
| `files` | `book.json`, chapters, `images.json`, images |
| `trust` | Checked save and undo checkpoint |
| `background` | Window closed → agent working → notification |
| `visuals` | Muse Image → SAM 3.1 → transparent PNG |
| `voice` | Waveform and transcript at the caret |
| `interop` | `bookwriter` CLI and MCP, loopback token |
| `close` | “Your book. Your files. Your agent.” |

## Rules

- Use the tokens from `packages/ui/src/styles/tokens.generated.css`; do not invent colours or type.
- The plates frame the UI; they never replace a real app screen. Composite them over captures from the
  fixture library.
- The page is deterministic: `window.renderAt(ms)` sets every reveal and progress state. No wall-clock
  animation is used for a rendered frame.
- Keep text on screen for at least 1.5 seconds in the edit.
- Do not put a competitor name, a real author's data or a provider key in a plate.
