# Research: profile cleanup on uninstall (D-174)

**Task:** 009 T025 · **Status:** research recorded, decision not accepted — nothing is deleted here.
**Evidence:** `apps/desktop/tests/profile-cleanup-premises.test.ts` (3 pass, mocked Electron
root, synthetic settings); `apps/desktop/src/main/settings.ts` (`studio.json`: libraryRoot,
windowBounds, pluginFolder); `apps/desktop/src/main/credentials.ts`
(`credentials.json` under the same root); T023/T024 premises (shared version-free root,
builder targets). No live provider, real profile, real uninstaller or device was used.

## Inventory (observed, complete)

The application profile is exactly two files under the per-app `userData` root:

- `studio.json` — libraryRoot (a path string), windowBounds, pluginFolder (a path string).
  Proven: it holds pointers, never manuscript prose; a missing file reads as defaults.
- `credentials.json` — the encrypted credential vault. Proven: same root, fixed name.

Everything else the app writes goes to the author-chosen library folder (manuscript,
images, threads, conflicts, drafts flushed to chapters) or to throwaway test profiles.
`STUDIO_USER_DATA` relocates the whole profile; nothing else needs relocating.

## Why deletion is safe to offer (and bounded)

- The profile contains no manuscript: deleting it cannot delete a book. The library is
  outside the profile root by construction, referenced only by path string.
- The profile is regenerable: a missing file reads as defaults, the author re-points at
  the library, credentials are re-entered. Nothing irreplaceable is lost beyond
  convenience (window placement, saved paths) and secrets the author chose to forget.
- Failure is closed by construction: each file is removed independently; there is no
  half-migrated state to leave behind, and a cancelled action removes nothing.

## Options considered

- Never offer cleanup (rejected): authors on shared machines need credential forgetting,
  and clean-slate reinstalls need a supported path. Telling authors to hand-delete files
  from `~/Library` is worse than an explicit, itemized, cancellable action.
- Hook each platform's uninstaller (rejected): macOS drag-to-trash and AppImage deletion
  have no uninstall hook; only the Windows installer could carry one. Platform variance
  would make the offer inconsistent. A uniform in-app action works on all three targets.
- Single "delete everything" button (rejected): credentials and settings have different
  consequences (re-entering secrets vs re-pointing at a library). The confirmation must
  itemize.
- Include the library in cleanup scope (rejected outright): the library is not profile
  data. It must never be listed, selected, or touched by cleanup under any option.

## Recommendation

Offer a separate, optional, in-app profile cleanup (Settings), available any time — not
tied to the uninstall moment, identical on all targets. Rules: explicit opt-in, never
default-on and never bundled with anything else; itemized confirmation naming each file
with its plain description (`studio.json` — app settings and library location;
`credentials.json` — saved provider credentials) and full paths; cancel closes with no
writes; library never listed; no telemetry of the choice. Deleting credentials only
forgets them (rotation-friendly); the encrypted file is removed like the settings file.

## What this unblocks when accepted

T028 implements the uninstall contract with the optional cleanup exactly as decided
(itemized confirmation + cancellation test); T027's upgrade path reuses the inventory.
Uninstall itself stays preservation-only regardless.
