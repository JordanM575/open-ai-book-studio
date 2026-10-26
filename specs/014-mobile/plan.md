# Implementation Plan: Mobile targets

**Branch**: `014-mobile` · **Date**: 2026-10-24 · **Spec**: [spec.md](spec.md)

## Summary

Keep the current React renderer as the single UI. The responsive iPhone/iPad mini layouts are already implemented in the Electron renderer and captured at reference sizes. Complete the remaining acceptance gaps as a spec-driven second pass: audit coarse-pointer hit areas and compact controls, consume the real static web build from spec 013 in the Capacitor shell, apply safe-area behavior, and verify orientation/draft continuity in the real iOS Simulator.

The Capacitor shell spike proved that Capacitor 8.5.3 can launch a bundled page in WKWebView. It did not prove that the real renderer, browser storage adapter, provider flow or iOS safe areas work. Spec 010 and 013 remain prerequisites for that integration.

## Technical Context

**Language / version**: TypeScript 7, React 19, Electron 45; Capacitor 8.5.3 for iOS shell.

**Primary dependencies**: Existing renderer/UI; Capacitor iOS plugin set only after D-117 platform research. Expo and React Native remain excluded.

**Storage**: Existing desktop library remains unchanged. Capacitor consumes spec 010/013 web storage adapter until iOS-native Filesystem/Keychain behavior is separately accepted; it does not introduce a new source of truth.

**Testing**: Bun unit tests, hidden Electron smoke, device-size captures, Playwright/Node browser E2E where available, and iOS Simulator orientation/touch verification.

**Target platform**: iPhone 393 × 852, iPad mini 744 × 1133, iPad mini landscape 1133 × 744, desktop 1440 × 900 remains supported.

**Performance goals**: No horizontal overflow; layout changes do not lose selected chapter or pending editor text. Touch targets are at least 44 × 44 logical points on coarse pointers.

**Constraints**: Mobile shell is Capacitor only; no Node access in renderer; no changes to file format/save protocol; safe-area insets apply only in the native webview as well as respecting browser viewport behavior.

## Constitution Check

- Local-first file and save rules remain owned by the adapters (pass).
- Only platform adapter/main process writes its library; renderer controls use the existing bridge (pass).
- Visual work uses vendored tokens, solid manuscript, neutral glass and accessibility preferences (pass).
- Feature changes start with spec/plan/tasks (pass; this plan closes the prior tracking gap).
- Desktop layout and hidden smoke remain regression gates (pass).

No constitution exception is required.

## Current State and Architecture

### Delivered

Commit `eb8cfa2` added responsive library/workspace layouts, compact header, bottom action bar, chapter drawer, full-screen agent sheet, tablet rail, manuscript sizing, responsive dialogs, and the `STUDIO_WINDOW_SIZE`/`STUDIO_CAPTURE` screenshot harness. The screens were manually rendered at iPhone, iPad mini and desktop sizes. The Capacitor shell spike is recorded in `docs/research/capacitor-ios-spike.md`.

### Remaining

1. Audit actual control bounds on coarse pointers. The spec requires 44px targets; current icon and small controls use 28–40px desktop sizes and must grow without changing their visual appearance on mouse devices.
2. Add mobile browser/webview viewport and safe-area integration once `apps/web` exists.
3. Add `apps/mobile` Capacitor config whose `webDir` consumes spec 013 output; do not duplicate renderer assets or add Expo/React Native.
4. Verify orientation changes preserve selection and text, and the real web build renders in iOS Simulator.

## Project Structure

```text
apps/desktop/src/renderer/src/views/WorkspaceView.tsx     responsive workspace
apps/desktop/src/renderer/src/views/LibraryView.tsx        responsive library
apps/desktop/src/renderer/src/components/ChapterRail.tsx   rail and phone drawer
apps/desktop/src/renderer/src/components/ChatPanel.tsx     agent sheet/panel
apps/desktop/src/renderer/src/components/ManuscriptEditor.tsx manuscript sizing
apps/desktop/src/renderer/src/styles/base.css             touch targets and safe areas
apps/web/                                                   static renderer from spec 013
apps/mobile/                                                Capacitor shell/config only
scripts/capture.mjs                                         device-size captures
specs/014-mobile/tasks.md                                   ordered implementation checklist
```

**Structure Decision**: Keep application UI in the shared React renderer; `apps/mobile` is only the native shell and plugins. Build/runtime entry and storage adapters are owned by specs 010 and 013.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing compact icon controls miss 44px minimum | Audit computed bounds on coarse-pointer viewports and add a CSS hit-area layer; keep mouse appearance unchanged. |
| iOS clears or evicts browser data | Use spec 010 disclosure/export behavior; do not claim desktop-equivalent durability. |
| Capacitor WebView differs from desktop screenshots | Load the actual static build in iOS Simulator, not a placeholder page; capture and inspect portrait and landscape. |
| Rotation interrupts text/save | Keep editor state in the shared renderer; test rotation during dirty text and wait for confirmed save. |
| Missing native plugin looks like a broken page | Show the supported fallback and recovery action; do not render a blank panel. |
| Safe-area padding applied twice | Apply it at the shell/viewport boundary and test both browser page and Capacitor WebView. |

## Verification

- At 393 × 852: one-column workspace, bottom bar, drawer, agent sheet, dialogs, no horizontal overflow; all touch controls meet 44 × 44.
- At 744 × 1133 and 1133 × 744: rail and manuscript fit, all intended actions are reachable, agent presentation follows the 1000px rule.
- At 1440 × 900: three-pane desktop remains unchanged.
- Verify light/dark and reduced transparency; keyboard focus remains visible.
- Rotate iPad mini while editor has unsaved text; confirm selected chapter and text remain and save state does not falsely report success.
- Run `bun run typecheck`, `bun test`, `bun run build`, `bun run smoke`; simulator tests use a disposable profile/library.

## Dependencies

- Spec 010 supplies the browser storage and library adapters.
- Spec 013 supplies the actual static web build and the shared UI package.
- D-117 continues to govern native plugin and iCloud questions. The shell proof alone does not close those decisions.
