# Tasks: packaging and release integrity

**Plan**: [plan.md](plan.md) · **Spec**: [spec.md](spec.md)
**Gate**: D-115 is deferred. Phases 2–4 MUST NOT start until it is accepted. Tasks below record the
intended order; they are not approval to sign, notarise or enable updates.

## Phase 1 — Release record and unsigned mode

- [x] T001 Add a release-record schema and `scripts/release/record.mjs` that hashes the artifacts that
      are actually served, writes version/commit/schema/platform/architecture/gates/signing status, and
      refuses a record whose file set does not match the artifact directory. No credentials.
      Implemented: `scripts/release/record.mjs` (importable `RECORD_JSON_SCHEMA`,
      `validateRecord`, `hashArtifacts`, `checkFileSet`, `buildRecordObject`; CLI with
      `--dir/--out/--version/--commit/--schema/--gates/--expect/--signing-status`) writes the
      plan's JSON shape, hashing every regular file in a flat artifact directory with streaming
      SHA-256 (names, sizes and hashes only — never contents), refusing empty/missing/nested
      directories, `--expect` mismatches and bare `signed` claims without an identity. It also refuses to replace an existing record and publishes the new one
      atomically (`publishRecord`).
      `apps/desktop/tests/release-record.test.ts` (12 pass) covers the valid record, refusals,
      schema validation, secret non-disclosure and hash ordering.
- [x] T002 Audit the existing unsigned path against spec 013: About, download page and release notes
      must all say unsigned before an informed tester opens the build. Record the exact surfaces.
      Audited 2026-11-03. Surfaces: (1) About — Settings `data-testid="about"` now carries a
      Signing row from `BuildMetadata.signing` (`packages/core/src/build.ts`, unsigned on every
      target until D-115), rendered by `SettingsDialog`; (2) release notes — the `bun run release`
      record (`releases/<version>-<commit>.md`) already states "Signed: no — unsigned build,
      shared only with informed testers (D-115 deferred)"; (3) download page — does not exist
      (no public download page; informed testers receive the artifact plus the record directly,
      per the D-115 trigger). The audit found About missing the row and added it with metadata
      and dialog tests (`settings-about.test.tsx`, `build.test.ts`); no other surface needed a
      change.
- [x] T003 Add a release-artifact scan for credentials, `.env` files, source maps and manuscript-like
      content; fail publication without printing the matching value.
      Implemented: `scripts/artifact-scan.ts` (`scanPaths`, `nameFinding`) walks artifact
      directories, extracts `.tar.gz` archives to scratch and scans the trees, and name-checks
      opaque containers (dmg/zip/executables). Name rules refuse `.env*`, `*.map`, credential
      files, library files (`book.json`, `library.json`, `images.json`), chapter files and
      `.studio`/`chapters`/`conflicts`/`threads`/`drafts` paths; content rules reuse the core
      redaction shapes (new `secretShapes()` export, derived so the lists cannot drift) plus
      `sourceMappingURL` references. Findings name file, class and line only — never values.
      Wired as the `release-artifact-scan` gate in `bun run release`, which blocks before the
      record. `apps/desktop/tests/artifact-scan.test.ts` (8 pass) covers clean/dirty trees,
      tarballs, opaque containers, CLI exit codes and secret non-disclosure.
- [x] T004 Add a release checklist that compares the record's SHA-256, version and commit with the
      artifact served and with About.
      Implemented: `scripts/release/check.mjs` (`checkRelease`, plus CLI) loads a record,
      re-hashes the served file and compares hash, bytes, version, commit and (when given)
      signing status against the About values the tester reads. A mismatch names the field,
      never file contents, and exits 1; unreadable inputs and schema failures exit 3, usage
      errors exit 2. `apps/desktop/tests/release-check.test.ts` (5 pass) covers the comparison
      matrix, an end-to-end record→check run with tamper and version drift, secret
      non-disclosure and refusal codes.

## Phase 2 — Signing and notarisation

- [ ] T005 **Blocked on D-115.** Configure `apps/desktop/electron-builder.yml` for Developer ID
      Application, hardened runtime, secure timestamp and the release environment's secret variables.
      Missing or invalid signing variables fail closed unless unsigned mode was explicitly requested.
- [ ] T006 **Blocked on D-115.** Add the least-privilege entitlements file and document why each
      entitlement is required.
- [ ] T007 **Blocked on D-115.** Add the sign/notarise/staple/verify script and run `codesign`,
      `spctl` and `stapler` against the `.app` and `.dmg` before publication.
- [ ] T008 **Blocked on D-115.** Extend the release record with signing identity/team, notarisation
      result and stapling result; make the release fail if any expected value is absent.
- [ ] T009 **Blocked on D-115.** Add a signed-artifact integration test that skips with a reason when
      no staging certificate is configured.

## Phase 3 — Update manifest and disabled path

- [ ] T010 **Blocked on D-115.** Define the signed `latest.json` schema and validator: channel,
      version, commit, schema, platform, architecture, minimum OS, URL, hash, publication time and
      signature/key id.
- [ ] T011 **Blocked on D-115.** Implement the disabled updater state: no network request, no background
      metadata fetch, and a Settings line that says updates are off.
- [ ] T012 **Blocked on D-115.** Implement manifest signature and hash verification with distinct
      refusal reasons for unknown key, bad signature, bad hash, stale/replayed manifest, downgrade,
      incompatible schema and unsupported OS.

## Phase 4 — Install, rollback and library safety

- [ ] T013 **Blocked on D-115.** Implement atomic application replacement that leaves the previous
      version runnable on download, verification or install failure.
- [ ] T014 **Blocked on D-115.** Refuse to update from a read-only location or without enough free
      space, before modifying the installed app.
- [ ] T015 **Blocked on D-115.** Prove with a fixture that a successful update and a rollback leave the
      library, `.studio/`, drafts and credentials byte-identical.
- [ ] T016 **Blocked on D-115.** Add the update state machine and diagnostics (disabled, checking,
      available, downloading, verifying, ready, installing, failed, rolled-back) without exposing
      manuscript or credentials.
- [ ] T017 **Blocked on D-115.** Add integration tests for bad signature, bad hash, downgrade,
      schema/OS mismatch, read-only location, disk full and failed install.
- [ ] T018 **Blocked on D-115.** Define the rollback window and keep the previous known-good artifact
      addressable; document the runbook.

## Phase 5 — Release automation and documentation

- [ ] T019 **Blocked on D-115.** Add the macOS release job with secrets scoped to that job, not to pull
      requests from forks; upload the record, checksums and notes.
- [ ] T020 **Blocked on D-115.** Write `docs/RELEASE.md`: signing prerequisites, unsigned mode,
      notarisation troubleshooting, update enable/disable policy and rollback.
- [ ] T021 **Blocked on D-115.** Wire the spec 012 gate list into the release job and record any waiver
      with owner and expiry.
- [ ] T022 Link the release record and update policy from `docs/DEPLOYMENT.md` and update
      `specs/README.md` when D-115 is accepted.

## Phase 6 — Author-facing installed-product lifecycle

The clarification tasks below precede the local install/upgrade work. Each decision blocks only the
dependent lifecycle task; none changes D-115's existing block on signing, notarisation, update-feed
access or automatic updates. No task here authorizes a download, publication, credential use or real
profile test.

- [ ] T023 Resolve and record in the public decision register whether D-115 also gates user-driven
      local installation and compatible local upgrade. State explicitly that signing, notarisation,
      update-feed access and automatic updates remain blocked by D-115. This decision blocks only
      local install/upgrade implementation and acceptance; it is not itself authorization to package
      or install anything.
      Research recorded 2026-11-03 (not accepted): `research/local-install-upgrade.md` pins the
      version-free shared settings file, write confinement to the profile root, no app version in
      the profile or `book.json`, side-effect-free opens and pre-write schema refusal; D-172
      proposes D-115 does not gate manual local install/compatible upgrade under override
      disclosure, unsigned labeling, same-schema-only and no feed/automation conditions.
      T027/T030 still wait on T024; T028 waits on T024/T025.
- [ ] T024 Resolve the lifecycle support matrix: claimed desktop targets/OS floors, native install and
      uninstall methods, stable per-user profile location per target, and how authors find that
      location. This blocks only platform-specific lifecycle implementation/acceptance, not unrelated
      release-record or documentation work.
      Research recorded 2026-11-03 (not accepted): `research/lifecycle-matrix.md` declares the
      three builder targets with standing, survey-only install/uninstall methods and per-OS
      profile paths, and defers exact OS floors to upstream confirmation; D-173 proposes the
      matrix with macOS release-blocking, profile-stays-on-uninstall and Settings discovery.
      T027/T028/T030 remain blocked; T025 still needs its own decision.
- [ ] T025 Decide whether any platform will offer a separate optional app-profile cleanup on
      uninstall. Keeping profile data and the library is the default either way. This blocks only an
      optional cleanup control; it does not block preservation-only uninstall behavior.
      Research recorded 2026-11-03 (not accepted): `research/profile-cleanup.md` inventories the
      two-file profile and proves pointer-not-prose storage, missing-file defaults and the shared
      root; D-174 proposes a uniform in-app optional cleanup with itemized confirmation, never
      default-on, library never in scope. T028's optional cleanup waits on acceptance;
      preservation-only uninstall is unblocked regardless.
- [x] T026 Reuse the 013 build metadata in About/recovery information for version, commit, schema,
      target, platform, architecture and observed signing status. Test with a synthetic artifact
      fixture; this identity display does not depend on the local install/upgrade policy.
      Implemented: `BuildMetadata` carries `platform`/`arch` via an injected `BuildHost`
      (desktop reports OS/CPU, web reports `web`/`unknown` per the unknown-label rule); About
      gains an Architecture row (`Unknown` when undetectable) beside the existing
      version/commit/schema/Format/target/platform/Signing rows. No support-summary UI exists
      yet — when user story 7/T029 builds it, it reuses this same metadata object. Tested
      with real and synthetic metadata in `settings-about.test.tsx` and `build.test.ts`.
- [ ] T027 Implement the approved stable profile identity and show its location separately from the
      chosen library; complete the compatible user-driven upgrade path. **Blocked on T023 and T024.**
      Prove with synthetic profiles and libraries that settings and library selection remain available
      and library bytes do not change; do not add update-feed or automatic-update behavior.
- [ ] T028 Implement the platform uninstall contract: remove the app but preserve the app profile and
      library by default. **Blocked on T024.** Add any optional cleanup only if T025 explicitly chooses
      it, with an itemized confirmation and a cancellation test. Use synthetic isolated data only.
- [x] T029 Integrate the schema refusal and manual recovery/reporting journey. Opening a book
      written by a newer build refuses before any write and opens a recovery dialog instead of a
      toast: it names the detected vs supported schema, points at the newer build that wrote the
      files and states reinstalling an older build does not change library files (FR-047). The
      user-reviewed local support summary reuses the T026 build metadata (version, commit, target,
      platform, arch, signing) with the compatibility outcome; it carries no manuscript text, no
      credentials and no absolute paths, and is copied only on request — nothing is sent anywhere
      (FR-048). Tested with synthetic newer-schema failures in `schema-refusal.test.tsx`
      (contract, summary content, copy, back-without-write); `mustCompatible` routes the
      workspace open path while mid-review re-reads keep their existing failure copy. No
      automatic transmission or real profile.
- [ ] T030 Exercise cancelled and failed local install/upgrade paths on each target approved by T024.
      **Blocked on T023 and T024.** Verify the prior-app/reinstall instruction is truthful and that
      every synthetic profile/library file remains unchanged; do not claim rollback can reverse a
      schema migration.
- [ ] T031 Complete the lifecycle acceptance matrix only for targets actually approved and exercised.
      Use synthetic isolated profiles/libraries; report unsupported or unverified targets as such and
      do not infer their result from another platform.

## Phase 7 — Open-source attribution

- [x] T032 Generate the open-source attribution from the build (D-186). `scripts/licenses.mjs`
      collects every package in the renderer, main, preload and web bundle graphs, the production
      dependencies electron-vite leaves external, and Electron with a pointer to its Chromium
      credits. Each build writes one `licenses.json` and its own section of `THIRD_PARTY_NOTICES.md`.
      Settings → About → Open-source licenses shows the list on desktop (`app:licenses`, read-only)
      and web (a same-origin fetch). `bun run submission:check` fails on no license, an unknown
      license, `UNLICENSED` or copyleft unless `scripts/license-allow.json` allows it with a reason;
      it allows none since its one exception, `@meta-sam/parser` on desktop (D-137), left the build
      with the cutout (D-158). Tested against a synthetic
      Bun-layout install in `licenses.test.ts`, the policy in `license-gate.test.ts`, the view in
      `licenses-dialog.test.tsx`, the web fetch in `apps/web/tests/licenses.test.ts`, the smoke run
      and four axe scans of the view in `bun run a11y`. Not yet proven: that the packaged archive
      ships exactly the listed packages.

## Completion condition

The spec is complete when phases 1 and 5 pass without certificates, and phases 2–4 pass with a staging
Developer ID and a signed update feed after D-115. The unsigned fixture remains a supported test path,
not a public release.

The installed-product lifecycle remains Draft until its clarification tasks are resolved and each
dependent acceptance task has passed on its claimed platform. D-115 continues to gate signing,
notarisation and online update work; its effect on user-driven local install/upgrade is decided only by
T023.
