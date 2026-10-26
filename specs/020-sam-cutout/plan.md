# Plan: SAM 3.1 cutouts

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Files

```
packages/core/src/images/segmentation.ts   SAM response grammar, box/mask parser, base85 decoder
apps/desktop/src/main/segmentation.ts     Meta Responses request, connection selection, errors
apps/desktop/src/main/ipc.ts              segmentation:segment and image:save-cutout
packages/app/src/lib/cutout.ts             Canvas composition of source + mask -> PNG
packages/app/src/components/IllustrationDialog.tsx  cutout mode and match picker
```

## Request

`POST ${metaBase}/responses` with the stored Meta connection:

```json
{
  "model": "sam-3.1",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        { "type": "input_text", "text": "the lighthouse keeper" },
        { "type": "input_image", "image_url": "data:image/png;base64,…" }
      ]
    }
  ],
  "stream": false,
  "metadata": { "mask_encoding": "one_bit", "include_confidence": "true" }
}
```

The response's `output` array carries an `output_text` item with one line per frame. `parseSegmentation`
extracts each record. The mask payload is base85 and may use either the lossless (`~`) or one-bit (`!`)
encoding; the marker decides the decoder. The parser returns boxes, object ids, confidence, raster
height/width and the decoded `Uint8Array` mask. Zero records is an empty success.

The base85 alphabet and one-bit packing follow the Meta client-library format; the implementation must
have fixture tests with a known small mask before any live call. If the one-bit decoder is wrong, fall
back to the default lossless encoding rather than guessing.

## Cutout

The main process returns the source image reference and the parsed mask; the renderer:

1. Loads the source bytes through `image:read` and draws them into a canvas at natural size.
2. Scales the mask raster to the image bounds (nearest neighbour) and sets alpha to 0 where the mask is
   0.
3. Exports `canvas.toBlob("image/png")` and sends the bytes to `image:save-cutout` with the source id.
4. The main process saves through the image store as `kind: "character"` with `cutoutOf`, hash and
   dimensions, then returns the record.

No native image library is added to the desktop. The canvas path is the same in the browser build once
Meta browser access is verified.

## Failure handling

- Prompt validation happens in core and in the renderer before a request.
- Provider errors go through `normalizeProviderError`; a policy refusal is not retried.
- A missing source file is a local `not-found`, not a provider call.
- A mask whose dimensions or payload are inconsistent is rejected before the canvas.

## Verification

- Fixtures: one-match, three-match, zero-match, confidence and one-bit/lossless payloads.
- Unit: prompt validation, base85 decode, raster dimensions, malformed token, zero matches.
- Provider: mocked fetch for success, 400, 401, 429 and a non-image source.
- UI: match picker, cutout preview, source missing.
- Manual: one live SAM request with a generated illustration and a transparent PNG saved.
