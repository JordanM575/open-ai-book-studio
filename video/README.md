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
2. Record the app at 1440×900, 2× scale, 30 fps, on the fixture library. Save each clip in
   `video/footage/` under the name [`footage/README.md`](footage/README.md) gives it.
3. Record the narration, or generate a licensed voice, as `video/footage/narration.wav`. Transcribe
   it with Muse Voice Transcribe, then lock each segment's `start` and `end` in
   [`edit/film.json`](edit/film.json) to where its line falls.
4. Build and check the cuts:

   ```bash
   node video/edit/assemble.mjs           # 3:00 master and its .srt in video/renders/
   node video/edit/assemble.mjs --cut30   # the 0:30 cut
   node video/edit/assemble.mjs --check   # timings and loudness; fails over 3:00, off the script or off −14 LUFS
   ```

   Run them with `env -u ELECTRON_RUN_AS_NODE` if your terminal sets it. Until a clip exists, its
   place is a slate that says "Footage pending", so the same command builds a timing preview today.
   Never upload a build that reports a pending clip.
5. Derive the 0:15 vertical cut and burn the captions in for the silent cut. Neither is automated yet.
6. Run the checks in the spec: truth, privacy, silent, phone, link.

The assembler renders any missing or stale motion plates and caption cards before it cuts. To render
them by hand, run `node video/motion/render.mjs --all --ambient --scene=problem` (also `files` and
`close`) and `node video/cards/render.mjs`. Add `--preview` to the cards command for one still per
card in `video/renders/cards/previews/`.

### The edit list

[`edit/film.json`](edit/film.json) has one segment per row of the script's shot table. Each segment has:

- its times;
- the voiceover and on-screen text, copied exactly;
- its event tag;
- `live`, what the shot needs and what to do if it fails;
- `picture`, a list of motion plates, clips and cards. A clip may set `in` and `out` (seconds) and
  `sound`, a gain from 0 to 1 for its own audio; a clip without `sound` is muted;
- `lowerThird`, false where a plate already carries the line;
- `cut`.

A clip's sound plays in sync with its picture: from its `in` point, after any earlier sources in the
segment, and only inside the beat the 0:30 cut takes. It is mixed with the narration at its gain, and
a mono clip plays in both channels. Only the strip (`shot-04-strip.mov`) has `"sound": 1`, so the
studio's spoken reply is heard; the other clips stay muted, so the app's sounds do not compete with
the narration. A clip without an audio stream, or a slate, adds no sound.

Set `"cut": true` to drop a segment's picture and its line, following `cutOrder`, which is the
script's cut order. `cut30` maps the plan's 0:30 cut (problem → agent → voice → background → close)
onto segments. The 0:30 cut has no narration unless `video/footage/narration-30s.wav` exists, and it
gets no captions file.

The master and the 0:30 cut are normalized in two loudnorm passes to about −14 LUFS integrated with a
true peak at or under −1 dBTP (spec 021 FR-010). `--check` measures each with ffmpeg's EBU R128 meter
and prints the result. It fails when a build with narration is outside −15 to −13 LUFS or peaks above
−0.5 dBTP; a build without narration is a preview, so its loudness is not held to that.

`--check` also fails when the voiceover, on-screen text, tags or cut order drift from
[`script.md`](script.md), which stays the source of truth.

The caption cards in [`cards/`](cards/) follow the motion-plate pattern. The page is
deterministic: `window.renderAt(ms)` sets every reveal. It uses the studio tokens and the type scale
at 1.5×.

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
