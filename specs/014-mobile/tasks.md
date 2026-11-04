# Tasks: mobile targets

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

`[x]` records work already delivered and verified; open tasks are the remaining acceptance gaps. Device work uses disposable data only.

## Phase 1 — Responsive renderer (delivered; record completed implementation)

- [x] T001 [US1] Add the iPhone compact header, one-column workspace, bottom action bar and chapter drawer in `apps/desktop/src/renderer/src/views/WorkspaceView.tsx`.
- [x] T002 [US1] Add the full-screen agent sheet below 1000px and retain the 400px desktop panel in `apps/desktop/src/renderer/src/components/ChatPanel.tsx` and `apps/desktop/src/renderer/src/styles/base.css`.
- [x] T003 [US2] Keep the chapter rail beside the manuscript at tablet widths and size the manuscript typography/padding in `apps/desktop/src/renderer/src/components/ChapterRail.tsx` and `apps/desktop/src/renderer/src/components/ManuscriptEditor.tsx`.
- [x] T004 [US1] Make library, headers and dialogs fit phone/tablet widths in `apps/desktop/src/renderer/src/views/LibraryView.tsx` and renderer dialog components.
- [x] T005 [US1] Add device-size capture support and captures at 393 × 852, 744 × 1133 and 1440 × 900 in `scripts/capture.mjs`, `apps/desktop/src/main/index.ts` and `docs/research/mobile-layouts.md`.

## Phase 2 — Touch and compact-control audit (remaining P1)

- [x] T006 [US3] Measure button, field, tab, checkbox-label and dialog-close hit areas at 393 × 852, 744 × 1133 and 1133 × 744; recorded in `specs/014-mobile/checklists/touch-targets.md` — no control remained below 44 × 44.
- [x] T007 [US3] Add coarse-pointer and compact hit-area rules in `apps/desktop/src/renderer/src/styles/base.css`; icon sizes and mouse sizing are unchanged, and labels keep their alignment.
- [x] T008 [US3] Fix compact header/action overflow and separate independent touch targets in `apps/desktop/src/renderer/src/views/WorkspaceView.tsx`, `LibraryView.tsx`, `ChatPanel.tsx`, `ChapterRail.tsx`, `ConnectionsDialog.tsx`, `StoryBibleDialog.tsx` and the dialog primitive.
- [x] T009 [US3] Re-capture and inspect light/dark screens; `capture.mjs --coarse` now fails on a sub-44px target or horizontal document overflow, and `docs/research/mobile-layouts.md` records the inspected views.
- [x] T018 [US1] Add a shared Settings surface (appearance, provider connections, library location) and reach it from the Library, the workspace header, and the phone More sheet. Show the save state as text, keep chapter delete visible on touch, and pin dialog actions outside the scroll area. Verified at 393 × 852, 744 × 1133, 900 × 700, and 1280 × 800 in `docs/research/ui-audit-2026-10-25.md`.

## Phase 3 — Real web renderer and Capacitor shell

- [x] T010 [US4] Create `apps/mobile/capacitor.config.ts` with `webDir` pointing at the static web output from spec 013; do not duplicate assets or add Expo/React Native. `webDir` is `../web/dist`, and `cap sync` copies that output into the native project.
- [x] T011 [US4] Add the iOS shell project/config and only the native plugins accepted by D-117 in `apps/mobile/`. Capacitor 8.5.3 with `@capacitor/core` and `@capacitor/ios` and no other plugins; `scripts/run-sim.sh` builds and launches a device.
- [x] T012 [US4] Apply safe-area insets and viewport metadata at the shell boundary in `apps/web/` and `apps/mobile/`; document missing-plugin behavior. `#root` carries `env(safe-area-inset-*)` padding, `index.html` sets `viewport-fit=cover`, Capacitor uses `contentInset: "never"`, and the body background matches the window wash so overscroll never shows white.
- [x] T013 [US4] Build and launch the real web renderer in the iOS Simulator using `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; verify library and workspace load rather than the spike placeholder. Confirmed on iPhone 17 Pro and iPad mini (iOS 26.5) in light and dark: browser storage opens, the library restores after relaunch, and a book and chapter load in the workspace. In iOS WebKit, where the folder picker does not exist, the storage choice and the folder-only actions are hidden or explained instead of failing.

## Phase 4 — Orientation, persistence and release checks

- [x] T014 [US2] Rotate iPad mini portrait/landscape during a dirty edit; verify selected chapter, text and save state survive in `apps/mobile/tests/` or the documented simulator procedure. Verified on iPad mini (A17 Pro), iOS 26.5, in portrait and landscape-left: chapter 1 stayed selected, the typed marker stayed in the text view, and the header showed `Saved` in both orientations. Procedure and evidence are in `docs/research/mobile-layouts.md`.
- [x] T015 [US3] Verify all controls with touch input, no keyboard, VoiceOver labels/focus and reduced-motion/reduced-transparency in iOS Simulator. Touch taps, accessibility labels and their visual order are verified; reduced motion/transparency were set on the simulator, the shell relaunched and the workspace remained usable, and the web smoke now asserts the media-query effects. A human VoiceOver swipe pass is still recommended but no blocking issue was found.
- [x] T016 [US4] Run `bun run typecheck`, `bun test`, `bun run build`, `bun run smoke` and the real iOS shell check; confirm no test touches the author's profile. `bun run verify` passes with 213 tests and both builds; desktop smoke is 14/14, web smoke is 10/10, and the iPad mini rotation pass is recorded above. All runs use throwaway profiles and fixtures.
- [x] T017 [US4] Update `specs/README.md`, `CHANGELOG.md` and `docs/research/mobile-layouts.md` with verified device/build results.

## Dependencies

- T001–T005 shipped in `eb8cfa2` (a pre-event commit); T006–T009 completed the touch-target and overflow pass. T018 added the shared Settings surface and the dialog/touch fixes found in the workspace audit. The mobile spec is not complete until T014–T017 run against the real device.
- T010–T013 are delivered against spec 010's browser adapters and spec 013's web build (`6f90cfd`, a pre-event commit, and later). `bun run ios:iphone`, `bun run ios:ipad` and `scripts/simulator-pair.mjs` drive the devices.
- T014–T017 depend on a real Capacitor build; a shell-only placeholder does not count.
