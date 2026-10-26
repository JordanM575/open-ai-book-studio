# Quickstart: browser storage and archive verification

**Spec**: [010-web-target](spec.md) · **Plan**: [plan.md](plan.md)

## Prerequisites

- Bun workspace dependencies installed.
- Browser app entry and static build from spec 013 are present before end-to-end checks.
- For folder access, serve from HTTPS or localhost. Run browser tests with isolated temporary profiles; never point a test at an author's real library.

## Fast checks

```sh
bun run typecheck
bun test
bun run build
bun run smoke
```

Expected: core, adapter and archive unit/conformance tests pass; existing desktop build and hidden smoke still pass.

## Adapter conformance

Run the same conformance cases against the in-memory and desktop adapters:

1. Create a library, create a book/chapter, read/write bytes and verify stable format/IDs.
2. Save with matching base version/hash; verify complete new file and no-op equality behavior.
3. Change the file after the base snapshot; verify `changed` and a conflict copy, with neither version discarded.
4. Inject write failure before commit; verify the previous complete file remains byte-identical.
5. Move to trash and restore without permanent deletion.

Run browser adapter tests against isolated browser profiles:

1. Folder picker supported: choose a temporary folder, save, reload, deny permission, then re-grant. Verify no silent origin-store fallback.
2. Folder picker unavailable: create in origin storage, reload and reopen, request persistent storage, and verify the UI reports granted or not granted honestly.
3. Open the same library in two tabs and save from both; verify locks or conflict copies prevent silent overwrite.
4. Fill/deny storage and revoke folder access; verify save state, preserved prior file, clear recovery action and usable editor.

## Archive checks

1. Export a fixture with multiple books, chapters, images, conflicts, trash and unknown files.
2. Import into a new temporary destination and compare every included path, hash and book/chapter ID.
3. Try traversal/absolute/duplicate paths, symlink entries, corrupt hashes, newer schemas, over-limit archives and insufficient quota. Verify rejection before publishing and unchanged existing library.
4. Search ZIP bytes and serialized manifests for `sk-`, `sk-or-`, bearer tokens and fake credentials; none may appear.

## Real-browser storage harness

`apps/web/check/` builds a small page that exercises OPFS, checked saves, a stale-save conflict,
archive export/import and IndexedDB in a real browser. It removes its temporary libraries.

```bash
cd apps/web
bun run build:check
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/` and confirm `document.body.dataset.result` is `pass`. The folder
picker remains a manual, user-initiated check.

## Cross-build and device check

Once spec 013 and 014 integration land:

- Build web static assets, open the same fixture in Chromium folder mode and Safari/Firefox origin-storage mode.
- Export from browser and import into a fresh desktop folder; compare source files and IDs.
- Load the real web build in Capacitor iOS Simulator. Verify the storage disclosure, save/error states, safe areas and rotation persistence at iPhone/iPad mini reference sizes.

## Failure evidence

Test runs must print operation and safe error code, not manuscript content, API keys, full provider payloads or absolute host paths. All filesystem fixtures and browser profiles are temporary and removed after the test.
