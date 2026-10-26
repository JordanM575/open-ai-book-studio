# Product film

The submission master is a three-minute film about the real app. The argument is **the agent works on
the actual book, and the author keeps the actual files** — see
[`specs/021-product-film/spec.md`](../specs/021-product-film/spec.md).

## Read in this order

1. [`script.md`](script.md) — timed narration, on-screen text and the benefit line for each shot.
2. [`storyboard.md`](storyboard.md) — every UI state, capture method, motion plate and transition.
3. [`assets.md`](assets.md) — music, voice, fonts, icons and licences.

## Produce it

1. `rm -rf video/fixture/library && bun run film:fixture` for the original fixture book, then open it
   in a throwaway profile. See [`fixture/README.md`](fixture/README.md).
2. Build the motion plates with the design tokens; capture them frame-exactly through Playwright.
3. Record the app at 1440×900, 2× scale, 30 fps, on the fixture library.
4. Record the narration, or generate a licensed voice; transcribe with Muse Voice Transcribe for
   captions and timing.
5. Edit the 3:00 master, then derive the 0:30 and 0:15 cuts.
6. Run the checks in the spec: truth, privacy, silent, phone, link.

## Do not

- Do not show a real library, a personal path, a key, an email or a notification from another app.
- Do not fake a save, a notification, a tool call or a provider response.
- Do not use a competitor’s mark, a cloned voice or unlicensed music.
- Do not claim a number or feature the recorded build does not have.

## File names

```
ai-book-studio-film-<version>-<date>-master.mp4
ai-book-studio-film-<version>-<date>-30s.mp4
ai-book-studio-film-<version>-<date>-15s-vertical.mp4
ai-book-studio-film-<version>-<date>.srt
ai-book-studio-film-<version>-<date>-thumbnail.png
```

Renders live outside git (`video/renders/` is ignored); the script, storyboard, asset manifest and
project files are committed.
