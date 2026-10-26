# Tasks: packaging and release integrity

**Plan**: [plan.md](plan.md) · **Spec**: [spec.md](spec.md)
**Gate**: D-115 is deferred. Phases 2–4 MUST NOT start until it is accepted. Tasks below record the
intended order; they are not approval to sign, notarise or enable updates.

## Phase 1 — Release record and unsigned mode

- [ ] T001 Add a release-record schema and `scripts/release/record.mjs` that hashes the artifacts that
      are actually served, writes version/commit/schema/platform/architecture/gates/signing status, and
      refuses a record whose file set does not match the artifact directory. No credentials.
- [ ] T002 Audit the existing unsigned path against spec 013: About, download page and release notes
      must all say unsigned before an informed tester opens the build. Record the exact surfaces.
- [ ] T003 Add a release-artifact scan for credentials, `.env` files, source maps and manuscript-like
      content; fail publication without printing the matching value.
- [ ] T004 Add a release checklist that compares the record's SHA-256, version and commit with the
      artifact served and with About.

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

## Completion condition

The spec is complete when phases 1 and 5 pass without certificates, and phases 2–4 pass with a staging
Developer ID and a signed update feed after D-115. The unsigned fixture remains a supported test path,
not a public release.
