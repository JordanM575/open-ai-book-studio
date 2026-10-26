# Character cutouts with SAM 3.1

**Status:** Planned (2026-10-26)
**Number:** 020
**Depends on:** [019](../019-illustrations/spec.md) image store and illustration panel,
[011](../011-model-access/spec.md) Meta connection.

## Why

An illustration becomes useful to the rest of the book when the author can lift a character out of it.
A transparent PNG can become a character card, a cover element or a reference for the next image. SAM
3.1 finds the object from a short noun phrase; the studio only has to present the matches, let the
author choose one and save the cutout as another author-owned image.

## User stories

1. **Cut out a character.** Open a saved illustration, choose Cutout, type `"the lighthouse keeper"`,
   see the matches highlighted, choose one and save a transparent PNG. The source image is unchanged.
2. **Attach it.** The cutout is recorded as a `character` image with `cutoutOf` pointing at the source,
   so the gallery can show where it came from.
3. **No match.** SAM returns zero matches for a concept that is not in the image. The panel says so and
   offers another phrase; nothing is written.
4. **Refusal or failure.** A bad prompt, an unsupported image or a provider error leaves the source and
   manifest untouched and explains what failed.
5. **Keep it local.** Only the source image and the noun phrase go to Meta. The cutout is saved in the
   book folder; no background removal service is involved.

## Requirements

- **FR-001** A cutout request MUST use the Meta connection, `POST /v1/responses` with model `sam-3.1`,
  a single `input_text` noun phrase and the source image as a base64 `input_image` data URL.
- **FR-002** The prompt MUST be one short noun phrase, 1–200 characters. Commands, multiple concepts,
  negation and boolean lists are refused locally with a helpful message instead of being sent.
- **FR-003** The source image MUST come from the book's image store. The service MUST NOT fetch a URL,
  accept an arbitrary path or read outside `books/<bookId>/images/`.
- **FR-004** The request MUST set `metadata.mask_encoding` to `"one_bit"` and
  `metadata.include_confidence` to `"true"`; the parser MUST read the marker on each mask rather than
  assuming the requested encoding.
- **FR-005** The response parser MUST handle the documented token grammar: frame marker, object id,
  box, mask, base85 payload, height-first raster dimensions and optional confidence. Zero matches is a
  valid empty result, not an error.
- **FR-006** The author MUST choose one match when several are returned. The panel highlights boxes and
  shows the object id and confidence; it never silently picks the first.
- **FR-007** The transparent PNG MUST be produced in the renderer from the source image and the decoded
  mask, then saved through the image store as a new record with `kind: "character"`, `cutoutOf` and the
  source dimensions. The source file and manifest record are not modified.
- **FR-008** A cutout is limited to 20 MB and the source's dimensions. The alpha channel is binary:
  masked pixels are transparent, the rest are fully opaque. Edge feathering is a later feature.
- **FR-009** If the source image is missing, unreadable or not PNG/WebP/JPEG, the panel says the file is
  unavailable and writes nothing.
- **FR-010** The cutout is desktop-first. The web build may show it only after Meta browser access is
  verified; otherwise it explains the desktop requirement.
- **FR-011** The panel shows the exact provider cost only if the API returns it; otherwise it labels the
  cost as unknown and does not invent a figure. The request is initiated by the author.
- **FR-012** No mask, source bytes or prompt is stored in logs, the thread store, telemetry or a
  studio-controlled server.

## Non-goals

- Video segmentation, tracking or multi-frame masks.
- Manual box/point drawing, brush refinement, feathering or mask editing.
- Segmenting several concepts in one request.
- A general background remover or an external cutout service.
- Automatic character recognition or attaching a cutout without the author's choice.

## Acceptance scenarios

1. **One match.** Segment `"red hat"` in an illustration. The panel shows one box, the author confirms,
   and `images/` gains a transparent PNG whose record points at the source.
2. **Several matches.** Segment `"person"` and get three boxes. The author chooses the second; only that
   mask becomes a cutout.
3. **No match.** Segment `"spaceship"` in a landscape. The panel reports zero matches and writes no
   record.
4. **Bad prompt.** Send `"find the person on the left"` or `"cat or dog"`. The panel refuses locally and
   no request is made.
5. **Provider failure.** A 401 or 429 leaves the source image and manifest unchanged and shows one
   sentence.
6. **Source moved.** Delete the source file outside the studio, reopen the panel. The cutout action is
   disabled with a clear message.

## Open decisions

- **D-132** Cutout compositing location: the renderer produces the PNG from the source and a binary mask
  so the desktop does not add a native image library. Accepted by author direction on 2026-10-26;
  implementation follows this spec.
- **D-133** Manual point/box prompts: deferred; the first version uses concept prompts and author
  selection.
