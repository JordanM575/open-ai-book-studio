# Implementation Plan: Packaging and release integrity

**Branch**: `009-packaging-release` · **Date**: 2026-10-26 · **Spec**: [spec.md](spec.md)
**Status**: Draft; signing and online update work is gated by D-115; local install/upgrade policy is unresolved

## Summary

Add a release layer around the desktop artifact that spec 013 already builds. The work has three
parts:

1. Produce a verifiable macOS release: Developer ID signing, hardened runtime, notarisation and
   stapling, with an explicit unsigned mode.
2. Publish a release record with checksums, signature identity, commit/version/schema and gates.
3. Define and test a static, signed update manifest and an atomic updater, but keep the update path
   disabled until D-115 is accepted.

The build, artifact naming, staging and deployment rollback stay in spec 013. The updater replaces the
application bundle only; it never opens or writes a library.

Add a distinct author-facing installed-product lifecycle: identify the running app, keep one stable
per-user profile across compatible builds, preserve the profile and the author-chosen library on
uninstall by default, refuse an unsupported library schema without writing, and give manual recovery
and reporting steps. This is not 013's artifact build, staging/promotion or deployed-artifact rollback.
Whether D-115 also governs user-driven local install/upgrade remains open; this plan does not authorize
those operations.

## Current state

- `apps/desktop/electron-builder.yml` produces an unsigned unpacked app with `package:dir`; `bun run
  dist` is the installer path. The app is labelled unsigned in About and release notes through spec
  013.
- `docs/DEPLOYMENT.md` defines artifact names, gates, promotion and rollback.
- `scripts/build-info.mjs` stamps version, commit and schema into the build.
- There is no signing configuration, notarisation hook, update manifest or updater in the
  repository. Release records exist in two forms: the human Markdown record from 012 T023
  (`bun run release`) and the machine JSON record from 009 T001
  (`node scripts/release/record.mjs`).
- D-115 is deferred: no certificate and no public update channel. Unsigned builds are the current
  shipping path.
- Public spec 013 defines build metadata, desktop packaging and deployment rollback; public specs 001
  and 002 define library schema refusal. They do not define installed-profile continuity, uninstall
  retention or manual installed-app recovery. These lifecycle items are proposed, not reported as
  implemented or accepted.
- The desktop main process already uses Electron's per-user `userData` area for app-owned state. The
  proposed contract is to keep that profile stable across compatible versions and distinct from the
  author-selected library; exact supported targets, platform paths and native uninstall behavior need
  clarification before platform-specific implementation.

## Technical approach

### Signing and notarisation (blocked by D-115)

- `apps/desktop/electron-builder.yml` gains a macOS section configured from environment:
  - `CSC_LINK` and `CSC_KEY_PASSWORD` for the `.p12`;
  - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarisation;
  - `hardenedRuntime: true`, `gatekeeperAssess: false`, explicit `entitlements` and
    `entitlementsInherit`.
- A small `scripts/release/mac.mjs` (or the electron-builder afterSign hook) submits the `.app` for
  notarisation, waits for the result, staples the `.app` and `.dmg`, and runs:
  - `codesign --verify --deep --strict --verbose=2 <app>`;
  - `spctl --assess --type execute --verbose=4 <app>`;
  - `xcrun stapler validate <app>` and the `.dmg`.
- The identity is never guessed. If `CSC_LINK` is absent, the release command enters **unsigned mode**
  and writes `signing: "unsigned"` into the record. If a signing variable is present but invalid, the
  command fails; it does not fall back.
- Entitlements are an allow-list. Start with the Electron minimum (JIT, unsigned executable memory,
  network client if required) and add nothing without a feature that needs it.

### Release record and provenance

`scripts/release/record.mjs` writes a JSON record next to the artifacts:

```json
{
  "schemaVersion": 1,
  "version": "0.1.0",
  "commit": "…",
  "schema": 1,
  "platform": "darwin",
  "arch": "arm64",
  "artifacts": [
    { "name": "AI Book Studio-0.1.0-mac-arm64.dmg", "sha256": "…", "bytes": 0 }
  ],
  "signing": { "status": "signed", "identity": "Developer ID Application: …", "teamId": "…" },
  "notarization": { "status": "accepted", "staple": "valid" },
  "gates": ["typecheck", "test", "smoke", "web-smoke"],
  "unsigned": false
}
```

A record that already exists is never replaced. The script writes the new record to a temporary
file beside the target and hard-links it into place, so an existing record is refused (exit 3) and
left as it was, and the final path never holds a half-written file. On a file system without hard links the script publishes nothing and says so, rather than writing the
record in place.

The record is input to the release notes and the update manifest. It must be produced from the bytes
that are actually served; a rebuild after the record is written is a release failure.

### Update manifest and updater (blocked by D-115)

The static feed is a directory of immutable versioned artifacts plus one signed `latest.json` per
channel:

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "0.2.0",
  "commit": "…",
  "schema": 2,
  "platform": "darwin",
  "arch": "arm64",
  "minimumOs": "12.0",
  "url": "https://…/AI-Book-Studio-0.2.0-mac-arm64.zip",
  "sha256": "…",
  "publishedAt": "2026-10-26T00:00:00.000Z",
  "signature": "base64…"
}
```

- The manifest signature is verified with an embedded public key; the key id is in the manifest. A
  rotation requires a new app build, not a remote key swap.
- The updater is a small main-process module with no renderer access to the manifest or filesystem.
  It exposes state through IPC: `disabled`, `checking`, `available`, `downloading`, `verifying`,
  `ready`, `installing`, `failed`, `rolled-back`.
- When D-115 is not accepted, `checkForUpdates()` returns `disabled` without a network call and the
  Settings surface says updates are off.
- When enabled, a check is an explicit author action (or a policy-approved launch check), downloads to
  a temporary file, verifies the hash and signature, and only then replaces the app. The library path
  is never in the updater's payload.
- On macOS, use a signed `.zip`/`.dmg` and the platform's atomic replace semantics. Keep the previous
  version in a versioned directory until the new version has launched successfully and the author has
  opened a library; the exact retention window belongs to the D-115 policy.
- A schema newer than the app refuses the update and tells the author to update the app or open the
  library with a compatible build; it never runs a migration behind their back.

### Failure and recovery

- Disk-full, read-only location and permission failures are detected before replacing the app.
- A failed verification deletes the temporary artifact and leaves the current app untouched.
- A failed launch after install is recoverable through the previous version; the release record names
  the rollback.
- Logs include version, commit, channel and reason, never prose, keys or full signed URLs.

### Author-facing installed-product lifecycle (manual path; policy unresolved)

- Keep the installable application, Electron per-user `userData` profile and author-chosen library as
  three separate locations. A package install/upgrade may replace application files only; it does not
  move the profile, reset settings, choose a new profile based on the version, or migrate the library.
- Surface the exact app-profile location and installed build identity (version, commit, schema, target,
  platform, architecture and observed signing state) in About or recovery information. Reuse the shared
  build metadata from 013 rather than creating a second version source.
- Uninstall preserves profile and library by default. If a platform-native uninstaller offers profile
  cleanup, make it a separate, unselected author choice listing the exact data categories; cancellation
  preserves all data. Never include the library in app-data cleanup.
- Reuse the library's existing schema guard before writes. A build that cannot use the detected schema
  gives a refusal and compatible-build action before touching files; installation itself never migrates
  the library.
- A cancelled or failed local install/upgrade reports the actual outcome, preserves profile/library
  bytes and avoids a false success state. If a native installer cannot keep the prior app runnable,
  manual recovery points to the prior compatible artifact and does not promise to reverse a schema
  migration.
- A support summary is produced only on author action, is reviewable before copy/save, excludes prose
  and credentials, and is not uploaded. Absolute profile/library paths are omitted unless the author
  explicitly includes them.
- Do not add an updater or update-feed request to this manual path. The signing, notarisation, feed and
  automatic-update gates remain D-115's; the question of whether D-115 also covers local install and
  upgrade is a separate open clarification.

### Boundary with spec 013

Spec 013 owns workspace/build production, immutable artifacts, staging, promotion and rollback of a
deployed artifact. Spec 009 owns the author's trust and installed-product lifecycle after an artifact
exists, including compatibility-aware manual recovery of the local app. Neither path may imply that
restoring an application artifact restores or rewinds author data.

### Testing

- **Unit**: manifest schema, signature envelope, hash/URL validation, downgrade/schema/OS refusal,
  state machine, and the disabled path making no network call.
- **Integration**: signed staging artifact verification; unsigned fixture refusal; a failing signature
  and a failing hash; application preservation after a simulated install failure.
- **Release**: signature/notarisation/stapling commands against the actual artifact, plus a secret/source
  map scan.
- **Library safety**: hash the fixture library before and after a successful update and after a
  rollback; assert every file is unchanged.

## Files and ownership

```text
apps/desktop/electron-builder.yml        macOS signing/notarisation, artifact names
apps/desktop/build/entitlements.mac.plist least-privilege entitlements
apps/desktop/src/main/updates.ts         state machine, no direct renderer access
apps/desktop/src/main/ipc.ts             validated update-status/check/install channels
apps/desktop/src/preload/index.ts        narrow bridge
apps/desktop/src/renderer/...            Settings status and consent, existing design tokens
scripts/release/mac.mjs                  sign/notarize/staple/verify
scripts/release/record.mjs               release record and checksums
scripts/release/update-manifest.mjs      manifest signing and validation
.gitea/workflows/release.yml             macOS release job, secrets scoped to it
docs/RELEASE.md                          runbook, unsigned mode, rollback
docs/DEPLOYMENT.md                       link to release record/update policy
```

## Phases

1. **Provenance without signing** — define the record and checksum generator; use it for unsigned
   builds. This can land before D-115 and makes the current release honest.
2. **Signing and notarisation** — blocked by D-115 and a Developer ID certificate.
3. **Update manifest and disabled path** — implement the parser, signature verification and disabled
   state; no network when off. Blocked by D-115 because the policy is not accepted.
4. **Install and rollback** — atomic replacement, previous-version retention and failure tests.
   Blocked by D-115.
5. **Release automation** — secret-scoped macOS job, artifact scan and release notes.
6. **Verification** — unit/integration/release tests and spec 012 gates.

## Installed-product lifecycle delivery slice

This is additive to the existing release phases. First resolve the local-operation boundary for D-115,
the supported target/install-method matrix and stable per-user profile path. These clarifications block
only their dependent install/upgrade/uninstall implementation and acceptance tasks. They do not change
D-115's existing block on signing, notarisation, update feeds or automatic updates, and do not block
unrelated release-record/documentation tasks. A decision that declines local install/upgrade leaves the
corresponding behavior unimplemented rather than authorizing a workaround.

Use temporary synthetic profile and library fixtures for every lifecycle test. Verify the launched
artifact, not a source/dev build; compare profile/library file lists and hashes before and after
upgrade, cancel, failure, uninstall and schema refusal. Never use a real author profile for acceptance.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Certificate unavailable at hackathon | Explicit unsigned mode; signed tests skip with a reason; no fake trust |
| Notarisation rejected because of an entitlement | Minimal entitlements; submit a fixture build before a release |
| Updater damages the library | Updater replaces only the app bundle; library hash test before/after; schema updates stay in-app |
| Bad manifest or key rotation | Signed manifest with key id; reject unknown keys; rotate only with a new app build |
| Update while app is read-only or disk full | Preflight write/space checks; leave current app intact |
| Rebuild after checksum | Release record generated from served bytes; promotion, not rebuild, per 013 |
| Windows/Linux signing scope creep | v1 documents them as future; macOS is the release gate |
| Platform installer resets or deletes app data | Keep profile and library ownership separate; test each claimed native uninstall/upgrade path with synthetic fixtures |
| Version-specific profile identity strands settings or credentials | Stable product identity, visible profile location and a compatible-upgrade fixture gate |
| Old app opens a newer library | Reuse the schema guard; refuse before writes and report a compatible-build action |

## Verification

- `bun run typecheck`, `bun test`, `bun run build`, `bun run smoke` plus the spec 012 gates.
- Signed artifact: `codesign`, `spctl`, `stapler` and checksum match.
- Unsigned artifact: About/release notes say unsigned; signed-update tests skip.
- Updates disabled: no network request in an instrumented run.
- Update enabled (staging): good update installs; bad signature/hash/downgrade/schema/OS/read-only/disk
  full are refused; library hash unchanged; previous version runs after rollback.
- Secret scan of artifact and notes reports zero credentials and no source maps.
- Installed lifecycle (proposed): on each claimed platform, an isolated synthetic profile/library
  survives compatible manual upgrade, uninstall, cancellation and injected failure; incompatible
  schema refusal leaves library bytes unchanged and the author sees a manual next step. Support
  summaries contain no prose or credentials and are never sent automatically.

## Out of scope

The build and staging/promotion mechanics owned by spec 013, the library format, provider credentials,
App Store distribution, Windows/Linux signing, delta updates and hosted update services.

## Decision gate

D-115 must be accepted with a named certificate owner, an update feed location and a rollback window
before phases 2–4 start. Until then, only phase 1 (record/checksums) and documentation can land.

This existing D-115 gate continues to apply to signing, notarisation, update-feed access and automatic
updates. Separately, the public decision record must answer whether D-115 also gates user-driven local
installation/upgrade before those dependent tasks begin; do not treat this plan as having chosen either
answer. Platform targets, install/uninstall behavior and profile paths must also be clarified before
their dependent platform implementation. These decisions do not block unrelated phases.
