# Film footage

Put the recorded clips and the narration here. Git ignores every file in this folder except this
note, because footage can show more than the film should.

`node video/edit/assemble.mjs` reads this folder. A clip that is not here becomes a slate that says
"Footage pending", so the build still runs and the timing can be checked before anything is
recorded. Never put a stand-in here: a clip under one of these names is treated as the real shot.

## Capture

- Record the app at 1440×900 at 2× (2880×1800 pixels) and 30 fps, on the fixture library, as
  `video/script.md` describes. Other sizes are scaled to fit 1920×1080, and other frame rates are
  converted to 30 fps.
- One file per shot, named exactly as below. `.mov` is expected; the same name ending in `.mp4` or
  `.m4v` is accepted.
- The narration is one 48 kHz WAV for the whole film, read to the script's timings. Mono or stereo.

## File names

What each clip shows is in the script's shot table, which is the source of truth. "Planned" is the
length the edit list gives the clip; a longer clip is trimmed from its end, and a shorter one holds its
last frame. Set `in` and `out` (seconds) on the clip in `video/edit/film.json` to choose the part to use.

| File | Segment | Script | Capture order | Planned |
| --- | --- | --- | --- | --- |
| `shot-01-contributor.mov` | `contributor` | 0:25–0:43 | 1 | 18 s |
| `shot-02-agent-panel.mov` | `agent-panel` | 0:43–1:01 | 2 | 18 s |
| `shot-03-dictation.mov` | `dictation` | 1:01–1:15 | 3 | 14 s |
| `shot-04-strip.mov` | `strip` | 1:15–1:29 | 4 | 14 s |
| `shot-05-background.mov` | `background` | 1:29–1:45 | 5 | 16 s |
| `shot-06-illustration.mov` | `illustration` | 1:45–2:03 | 6 | 18 s |
| `shot-07-cli-mcp.mov` | `cli-mcp` | 2:03–2:19 | 7 | 16 s |
| `shot-08-offline.mov` | `offline` | 2:19–2:29 | 8 | 10 s |
| `shot-09-glasses.mov` | `glasses` | 2:29–2:40 | 9 | 11 s |
| `shot-10a-library.mov` | `opening` | 0:00–0:25 | 10 | 10 s |
| `shot-10b-finder.mov` | `close` | 2:40–3:00 | 10 | 7 s |
| `narration.wav` | every segment | 0:00–3:00 | after the footage | 3:00 |
| `narration-30s.wav` (optional) | the 0:30 cut | | | 0:30 |

## After recording the narration

The script's times are targets. Once the narration is recorded, transcribe it with Muse Voice
Transcribe, then set each segment's `start` and `end` in `video/edit/film.json` to where its line
falls in `narration.wav`. The assembler takes each segment's line from those times, so a segment
marked `"cut": true` drops its picture and its line together.
