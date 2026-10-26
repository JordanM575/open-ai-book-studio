# Browser storage matrix

Results from the real browser build. The app is served from `apps/web/dist` over localhost and
driven by `scripts/web-smoke.mjs` in a hidden Chromium window with a throwaway profile.

## 2026-10-25 — Chromium (Electron 45)

| Check | Result |
| --- | --- |
| Web welcome offers browser storage and folder access | pass |
| “Use this browser” opens an OPFS library | pass |
| Create a book and chapter | pass |
| Save prose with the base hash | pass (version 2) |
| Reopen the book and read the saved prose | pass |
| Library identifies itself as `browser://…` | pass |
| Page console errors | none |

Environment: macOS, Electron 45.0.0 (Chromium), viewport 393 × 852, hidden window, temporary
`userData` profile. The run creates its own library and deletes the profile afterward.

## 2026-10-26 — Playwright cross-browser

`bun run matrix:web` builds `apps/web/check`, serves it on localhost and runs the real OPFS, save,
conflict, archive, IndexedDB, folder-mode and permission checks. Playwright 1.64.1, headless, fresh
context per engine.

| Engine | Result | Detail |
| --- | --- | --- |
| Chromium | **16/16 pass** | capabilities, OPFS open, create, save, reopen, stale conflict, archive export/import, IndexedDB, folder mode through a picked OPFS handle, picker cancellation, denied folder permission with the pending folder retained, two-tab Web Lock serialization, OPFS survival across a page reload, quota estimate, cleanup |
| Firefox | OPFS finding | `getDirectory()`/handle creation did not complete; the harness reports the 10-second limit |
| WebKit | OPFS finding | `getDirectory()` failed with a transient error; the harness reports it |

Chromium is the required gate; Firefox and WebKit run as findings. The app now times out an origin
storage open after five seconds and tells the author to choose a folder or export an archive, instead
of leaving the welcome screen waiting. `bun run matrix:web --strict` requires every engine.

## Not yet covered

- The native folder picker and full permission re-grant/revocation; the picker is a native,
  user-initiated dialog. The harness covers cancellation and a denied re-grant.
- Quota exhaustion; the restart check covers a page navigation, not a full browser restart.
- Safari/WebKit and Firefox, where OPFS is the only tier and the save-picker fallback is used.
- Archive transfer through the browser file picker (core and desktop archive round-trips pass).

The full matrix and Playwright automation remain spec 010 T013/T027 and spec 012.
