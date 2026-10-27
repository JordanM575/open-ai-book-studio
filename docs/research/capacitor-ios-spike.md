# Capacitor iOS spike

**Status:** passed, throwaway project outside the repository

## Question

Can the studio's future web build ship through Capacitor and run on the local iOS Simulator with the
toolchain on this machine?

## Environment

- Xcode 26.6, iOS 26.5 (23F77) Simulator runtime, iPhone 17 Pro.
- Capacitor 8.5.3 (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`).
- TypeScript 7.0.2, Bun 1.4.3.
- Build target: `iphonesimulator`, `CODE_SIGNING_ALLOWED=NO`, derived data in the spike folder.

## What was built

A temporary project in `/tmp/abs-capacitor-spike` with a static `www/index.html` styled like the
studio's welcome card, and this configuration:

```ts
const config: CapacitorConfig = {
  appId: "studio.aibook.spike",
  appName: "AI Book Studio Spike",
  webDir: "www",
  ios: { contentInset: "always" }
};
```

Commands:

```bash
bun add @capacitor/core @capacitor/ios
bun add -d @capacitor/cli typescript
bunx cap add ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,id=<device>' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted studio.aibook.spike
```

## Result

- Xcode resolved `capacitor-swift-pm` 8.5.3 through Swift Package Manager and built the app.
- `simctl` installed and launched it on the booted iPhone 17 Pro.
- The WebView loaded the bundled page; the first meaningful paint took about 6.6 seconds on a cold
  simulator start, then the card and window wash rendered correctly.
- Screenshot: [capacitor-spike.jpg](capacitor-spike.jpg).

## What this proves

- Capacitor's WKWebView shell, Swift Package Manager integration, static asset copying and simulator
  launch work on this machine.
- No Expo or React Native dependency is needed.
- The future web build can be pointed at with `webDir`; the native project does not need to know how
  the web assets are produced.

## What it does not prove

- The real studio renderer, its CSS, or its browser storage adapter. Those need spec 010.
- Filesystem, SQLite, Keychain or iCloud plugins. Those are the next spike after the web target exists.
- OpenRouter CORS from the Capacitor origin.
- Device signing, TestFlight or App Store review.

## Recommendation

Keep Capacitor. After spec 010 produces a web build, create `apps/mobile` with this configuration,
point `webDir` at the web build output, and add the storage, key and index plugins behind the same
ports used by the browser build.
