# Implementation Plan: Mobile targets

**Branch**: `014-mobile` · **Spec**: [spec.md](spec.md)

## Summary

Keep the current React renderer as the single UI. The responsive iPhone/iPad mini layouts are already implemented in the Electron renderer and captured at reference sizes. Complete the remaining acceptance gaps as a spec-driven second pass: audit coarse-pointer hit areas and compact controls, consume the real static web build from spec 013 in the Capacitor shell, apply safe-area behavior, and verify orientation/draft continuity in the real iOS Simulator.

The Capacitor shell spike proved that Capacitor 8.5.3 can launch a bundled page in WKWebView. It did not prove that the real renderer, browser storage adapter, provider flow or iOS safe areas work. Spec 010 and 013 remain prerequisites for that integration.

## Technical Context

**Language / version**: TypeScript 7, React 19, Electron 45; Capacitor 8.5.3 for iOS shell.

**Primary dependencies**: Existing renderer/UI; Capacitor iOS plugin set only after D-117 platform research. Expo and React Native remain excluded.

**Storage**: Existing desktop library remains unchanged. The recorded shell slice uses spec 010's
browser adapter and spec 013's web build; it does not establish native storage or protected
credentials. Spec 014 owns their iOS integration through the shared contracts, without introducing a
new source of truth. D-117 and any other necessary native choices remain decision gates.

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

Commit `eb8cfa2` (a pre-event commit) added responsive library/workspace layouts, compact header, bottom action bar, chapter drawer, full-screen agent sheet, tablet rail, manuscript sizing, responsive dialogs, and the `STUDIO_WINDOW_SIZE`/`STUDIO_CAPTURE` screenshot harness. The screens were manually rendered at iPhone, iPad mini and desktop sizes. The Capacitor shell spike is recorded in `docs/research/capacitor-ios-spike.md`.

### Remaining

1. Audit actual control bounds on coarse pointers. The spec requires 44px targets; current icon and small controls use 28–40px desktop sizes and must grow without changing their visual appearance on mouse devices.
2. Add mobile browser/webview viewport and safe-area integration once `apps/web` exists.
3. Add `apps/mobile` Capacitor config whose `webDir` consumes spec 013 output; do not duplicate renderer assets or add Expo/React Native.
4. Verify orientation changes preserve selection and text, and the real web build renders in iOS Simulator.
5. Use prior findings instead of repeating a survey to resolve the native storage, protected-credential,
   permission and lifecycle choices individually. Implement the accepted integrations, including
   operation-level capability and refusal behavior, only after the applicable decisions.

## Project Structure

```text
apps/desktop/src/renderer/src/views/WorkspaceView.tsx     responsive workspace
apps/desktop/src/renderer/src/views/LibraryView.tsx        responsive library
apps/desktop/src/renderer/src/components/ChapterRail.tsx   rail and phone drawer
apps/desktop/src/renderer/src/components/ChatPanel.tsx     agent sheet/panel
apps/desktop/src/renderer/src/components/ManuscriptEditor.tsx manuscript sizing
apps/desktop/src/renderer/src/styles/base.css             touch targets and safe areas
apps/web/                                                   static renderer from spec 013
apps/mobile/                                                Capacitor shell/config and planned native integration
scripts/capture.mjs                                         device-size captures
specs/014-mobile/tasks.md                                   ordered implementation checklist
```

**Structure Decision**: Keep application UI in the shared React renderer. Spec 010 owns the shared
library port and browser adapters; spec 013 owns the web build and shared capability contracts. Spec
014 owns the Capacitor shell and native iOS storage, protected credentials, lifecycle, permissions and
capability/refusal integration against those contracts. No native adapter or plugin is selected here.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing compact icon controls miss 44px minimum | Audit computed bounds on coarse-pointer viewports and add a CSS hit-area layer; keep mouse appearance unchanged. |
| iOS clears or evicts browser data | For the browser-backed shell use spec 010 disclosure/export behavior; do not claim desktop-equivalent durability or native-adapter acceptance. |
| Capacitor WebView differs from desktop screenshots | Load the actual static build in iOS Simulator, not a placeholder page; capture and inspect portrait and landscape. |
| Rotation interrupts text/save | Keep editor state in the shared renderer; test rotation during dirty text and wait for confirmed save. |
| Missing native capability looks like a broken page | Explain the refusal and recovery action; do not silently change the author's storage tier or render a blank panel. |
| Safe-area padding applied twice | Apply it at the shell/viewport boundary and test both browser page and Capacitor WebView. |

## Verification

- At 393 × 852: one-column workspace, bottom bar, drawer, agent sheet, dialogs, no horizontal overflow; all touch controls meet 44 × 44.
- At 744 × 1133 and 1133 × 744: rail and manuscript fit, all intended actions are reachable, agent presentation follows the 1000px rule.
- At 1440 × 900: three-pane desktop remains unchanged.
- Verify light/dark and reduced transparency; keyboard focus remains visible.
- Rotate iPad mini while editor has unsaved text; confirm selected chapter and text remain and save state does not falsely report success.
- Run `bun run typecheck`, `bun test`, `bun run build`, `bun run smoke`; simulator tests use a disposable profile/library.
- For the native slice, record source implementation, synthetic/fault checks, Simulator evidence,
  separately authorized real-device evidence and release evidence as distinct results. Test permission
  loss, protected-store refusal, lifecycle interruption, pending saves and recovery without treating
  one evidence class as another.

## Dependencies

- Spec 010 supplies shared library ports and browser storage adapters.
- Spec 013 supplies the actual static web build, shared UI and capability contracts.
- D-117 remains proposed and governs its native plugin and iCloud questions alongside any other
  required decisions. The shell and existing Simulator checks do not close native storage,
  credential, lifecycle, device or release acceptance.
