# Plan: illustrations

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Files

```
packages/core/src/images/schema.ts       image record, manifest version, format/dimension checks
packages/core/src/images/store.ts        manifest + file read/write over LibraryPort
packages/core/src/images/index.ts        exports
apps/desktop/src/main/images.ts          Meta Muse Image request and provider error mapping
apps/desktop/src/main/library/store.ts   Library facade for the image store
apps/desktop/src/main/ipc.ts             image:list, image:generate, image:attach, image:read
packages/app/src/components/IllustrationDialog.tsx
packages/app/src/components/ManuscriptEditor.tsx  attached image rendering
apps/desktop/src/main/export.ts          DOCX image embedding
```

## Format

`images.json` is a versioned object, not a bare array, so a future migration has a place to land:

```json
{
  "schemaVersion": 1,
  "images": [
    {
      "id": "img_abc12345",
      "kind": "chapter",
      "chapterId": "ch_abc12345",
      "fileName": "img_abc12345.png",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1024,
      "bytes": 184320,
      "sha256": "…",
      "prompt": "a lighthouse in a storm, ink and wash",
      "provider": "meta",
      "model": "muse-image-1.0",
      "size": "1024x1024",
      "source": "generated",
      "createdAt": "2026-10-26T12:00:00.000Z",
      "costUsd": 0.01
    }
  ]
}
```

The store reads the manifest through the port, rejects a future schema version and treats a corrupt
manifest as empty with a warning. Image bytes are written to `images/.<id>.tmp`, then renamed to
`images/<id>.<ext>`, then the manifest is committed. A crash between the two leaves an orphan; the
recovery path lists it with `adopted: false` rather than inventing metadata.

## Generation

The desktop `ImageService` mirrors `VoiceService`:

1. Pick the Meta connection and read the secret in main.
2. POST JSON to `${base}/images/generations` with `n: 1`, `response_format: "b64_json"`,
   `output_format: "png"` and the requested aspect ratio.
3. Normalize errors with `normalizeProviderError`.
4. Decode base64, check PNG/WebP/JPEG signature, parse dimensions and byte size.
5. Return bytes and provenance; the IPC handler writes through the image store.

The estimate is a constant `$0.01` per successful image. The UI shows it before the request. Usage is
recorded on the image record; the existing token usage store is not a good fit for per-image pricing.

## Interface

The panel lives beside the existing Story Bible and model dialogs. It loads the chapter's images and
shows the newest attached image. Generate is disabled without a Meta connection, a prompt or while a
request is running. The preview uses an object URL that is revoked on close. Attach writes the
`chapterId` to the chosen record and clears the previous attachment for that chapter in the same
manifest commit.

## Verification

- Unit: manifest parse/migrate, format detection, dimension parsing for PNG/WebP/JPEG, atomic
  write/rename failure, corrupt manifest.
- Provider: mocked fetch for success, 400 policy refusal, 401, 429 and a truncated base64 payload.
- Archive: export/import round-trip with images and manifest.
- UI: panel states and attachment selection under happy-dom.
- Manual: one live Muse Image generation, inspect the folder, export DOCX.
