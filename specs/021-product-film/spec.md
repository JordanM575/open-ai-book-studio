# Product film and voiceover

**Status:** Planned (2026-10-26)
**Number:** 021
**Depends on:** the product surfaces in [002](../002-studio-v1/spec.md), [017](../017-voice-and-background/spec.md),
[018](../018-agent-toolkit/spec.md), [019](../019-illustrations/spec.md) and [020](../020-sam-cutout/spec.md);
branding research in [`docs/research/branding-2026-10-26.md`](../../docs/research/branding-2026-10-26.md).

## Why

The submission needs a three-minute demo video that judges can watch without the app open. The film is
not a feature list. It has to show the real product, the real files and the real agent, and make one
argument: **the agent works on the actual book, and the author keeps the actual files.**

The film also has to survive being watched by authors who have seen every “AI writing tool” demo. The
category already has craft feedback, hosted generation and planning with model choice. Our
difference is ownership, agency and interop, shown
rather than claimed.

## Audience and length

| Cut | Audience | Length | Where |
| --- | --- | --- | --- |
| Master | Hackathon judges, site hero | 3:00 max | Submission form, YouTube/Vimeo |
| Short | Social and README | 0:30 | X, LinkedIn, README embed |
| Vertical | Social | 0:15 | Shorts/Reels/TikTok |
| Silent | Autoplay and accessibility | 3:00 | Muted with burned-in captions |

The submission video is the master. The others are derived from the same timeline, not separate
productions.

## Story

1. **Problem (0:00–0:12).** A book scattered across tools and a chat window that cannot touch it.
2. **Reveal (0:12–0:25).** The studio opens; the book is a folder, not an account.
3. **Ownership (0:25–0:40).** Library, chapter files and Finder.
4. **Planning (0:40–0:55).** Story Bible: outline, cast, memories, arc.
5. **Agency (0:55–1:20).** One agent turn with tool calls, a checked save, an undo checkpoint and a
   visible diff.
6. **Voice (1:20–1:35).** Dictation with Muse Voice Transcribe, inserted at the caret.
7. **Background (1:35–1:55).** Close the window; the agent finishes; the notification arrives.
8. **Visuals (1:55–2:20).** Muse Image illustration, then a SAM 3.1 cutout saved as a transparent PNG.
9. **Interop (2:20–2:40).** `bookwriter` CLI and MCP server against the same open library.
10. **Close (2:40–3:00).** DOCX export, the folder in Finder, and the line **Your book. Your files.
    Your agent.**

Every shot carries one benefit line. Feature names alone are not enough.

**Amendment (2026-11-03).** This story changed to follow the event's demo-scope rule:

- Pre-event context sits in one opening segment labelled “Built before the event”, and every later
  segment shows only event work.
- Spec 020 is superseded (D-158), so the cutout beat is gone.

The current shot list, capture order and fallbacks are in
[`video/script.md`](../../video/script.md) (draft 2).

## Requirements

### Truthfulness

- **FR-001** Every frame MUST show the real application, real files and real states. No mock UI, no
  invented feature, no simulated success that the app cannot reproduce.
- **FR-002** Claims MUST match the build. The test count, model names, limits and “no account” copy are
  taken from the recorded build, not from this plan.
- **FR-003** The demo library MUST be original or public domain. No author manuscript, personal path,
  provider key, email, notification or avatar may appear.
- **FR-004** Event-built features MUST be identifiable. The README and video description state what was
  built during the hackathon and what existed before it.
- **FR-005** Competitor names or marks MUST NOT appear in the film. The branding research informs the
  position; it is not shown as a comparison table.

### Voiceover

- **FR-006** The primary narration SHOULD be the author/founder’s recorded voice. It is the most
  credible and avoids a synthetic-voice disclosure.
- **FR-007** A synthetic narration MAY be used only with a licensed voice and a visible description
  note (“Narration generated with …”). A cloned third-party voice requires written consent; never clone
  a competitor, actor or public figure.
- **FR-008** Meta’s documented voice surface for the event is Muse Voice Transcribe (speech-to-text).
  It MUST be used to transcribe the final narration for captions and timing. A Meta text-to-speech
  model may be used only if the event exposes one and the account has access.
- **FR-009** The script MUST be locked before recording. Pace 145–160 words per minute, present tense,
  short sentences, first person for the agent and second person for the author.
- **FR-010** The mix MUST be broadcast-safe: integrated loudness about −14 LUFS, true peak ≤ −1 dBTP,
  narration at least 6 dB above music, no clipped consonants.

### Picture and motion

- **FR-011** Master: 1920×1080, 16:9, 30 fps (60 fps optional for cursor motion), H.264/MP4, high
  profile, faststart. Record the app at 1440×900 at 2× scale where possible.
- **FR-012** Motion graphics MUST use the studio tokens and type scale. They frame the UI; they never
  replace it. No stock footage of writers, no generic AI particles, no purple gradients.
- **FR-013** Screen recordings MUST hide personal data, use a fixture library, disable notifications
  from other apps and show the real cursor. Cursor highlights and zooms are allowed; fake clicks are
  not.
- **FR-014** Captions MUST be burned in for the silent cut and supplied as SRT. Captions are checked
  against the spoken track, not auto-published unedited.
- **FR-015** Music MUST be licensed for commercial and hackathon use and credited in the description.
  No trending audio.
- **FR-016** The film MUST avoid flashing above three times per second, keep text on screen for at
  least 1.5 seconds, and provide a reduced-motion-compatible short cut without rapid zooms.

### Delivery

- **FR-017** Deliverables: master MP4, 30-second cut, 15-second vertical, SRT, transcript, thumbnail
  and the source project. File names include version and date.
- **FR-018** The master MUST be uploaded and the link checked in a private window before the submission
  form is opened. The repository MUST be public before the form is submitted.
- **FR-019** A shot list and asset manifest MUST record every capture, font, icon, music track and
  voice source with its licence or ownership.

## Non-goals

- Actors, a filmed founder story, a studio set or 3D animation.
- A live coding demo or a terminal-only developer film.
- Feature-by-feature parity with any competitor.
- Cloned celebrity or competitor voices.
- A separate film for every platform; all cuts derive from one timeline.

## Acceptance scenarios

1. **Judge watch.** A judge who has never seen the product can explain, after three minutes, that the
   agent edits local files, keeps undo, can work in the background, and that other agents can use the
   library.
2. **Truth check.** Every feature in the film exists in the recorded build; every number matches the
   verification output.
3. **Privacy check.** No real library, path, key, email or personal notification appears in any frame.
4. **Silent check.** The film makes sense muted with captions.
5. **Link check.** The master and the 30-second cut play in a private window and from the submission
   page.

## Open decisions

- **D-134** Voiceover source: record the author’s voice (recommended), or a licensed synthetic voice
  with disclosure. Accepted by author direction on 2026-10-26; the script supports either.
- **D-135** Motion-graphics toolchain: HTML/CSS scenes rendered through Playwright plus `ffmpeg`
  (recommended, reproducible in this repository), or an external editor project. The plan assumes the
  reproducible path.
- **D-136** Music licence: a paid royalty-free track or an original cue. No track ships until the
  licence is recorded in the asset manifest.
