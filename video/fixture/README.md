# Film fixture

The capture fixture is generated, not hand-edited:

```bash
bun run film:fixture
```

It writes `video/fixture/library` through the real `Library`/`ImageStore`, so it has the same
`book.json`, chapter, `images.json` and PNG layout the app reads. The folder is ignored by git; the
generator and this note are committed.

## What it contains

- **The Salt Road**, an original short book about a lighthouse keeper.
- Story Bible: outline, three-act arc, one character (Mara Venn), one memory.
- Two chapters: *The Light That Would Not Turn* and *The Door Under the Stairs*.
- A 1024×1024 chapter illustration, attached to chapter one.
- A 512×512 transparent figure of Mara, drawn in code and attached to her cast record.

The PNGs are drawn by `scripts/film-fixture.ts` with a small deterministic encoder. No network, no
image model, no author data.

## Use

1. `rm -rf video/fixture/library` if it exists.
2. `bun run film:fixture`
3. Open the folder in the desktop app with a throwaway profile:
   `STUDIO_TEST=1 STUDIO_USER_DATA=/tmp/film-profile bun run dev`
4. Record at 1440×900. Do not use the author’s real library.

The generator refuses a non-empty destination so it cannot overwrite a real library by accident.
