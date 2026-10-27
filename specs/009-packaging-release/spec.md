# Feature Specification: Packaging and release integrity

**Feature Branch**: `009-packaging-release`
**Status**: Draft, gated by D-115
**Input**: Complete the desktop distribution path after spec 013 builds an artifact: a signed and
notarised macOS application, a verifiable release record, and an update path that cannot damage the
author's library.

## Overview

Spec 013 owns the workspace, build outputs, staging, promotion and rollback of a deployed artifact.
This specification owns the trust layer around the desktop artifact:

- macOS code signing, hardened runtime, notarisation and stapling;
- release provenance (checksums, signature/team identity, commit and capability record);
- the update manifest and updater safety rules;
- the explicit unsigned mode used until D-115 is accepted.

D-115 is **deferred**. Until the author accepts a signing identity and an update policy, releases are
unsigned, labelled as unsigned, and shared only with informed testers. Auto-update stays disabled and
does not make network requests. This spec defines the contract that must be true before a public
download or an update channel is enabled; it does not bypass Gatekeeper or ask testers to disable it.

The build itself remains spec 013. Library safety remains the constitution: an app update replaces
the application, never the author's files.

## Clarifications

### Session 2026-10-26

- **Q: What is signed in v1?** A: The macOS application bundle and disk image. Windows and Linux
  signing are future work; their packaging remains spec 013.
- **Q: Where do signing credentials live?** A: In the release environment's secret store, never in the
  repository, build logs, artifact or release notes. The repository names the variables and documents
  how to rotate them.
- **Q: Is an update server allowed?** A: Not a studio-owned account or application server. An update
  feed is a static HTTPS location containing a signed manifest and immutable artifacts. The app may
  read it only after the author enables updates under the D-115 policy.
- **Q: Does an update ever touch a book?** A: No. It replaces the application bundle. The library,
  `.studio/` state, credentials and open drafts are outside the update payload. A failed update leaves
  the previous application usable.
- **Q: Is an unsigned build a failed release?** A: No. It is an explicitly labelled test build. It must
  not be presented as a public download or used to test the signed-update path.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch a trusted macOS build (Priority: P1)

An author downloads a release, opens it, and macOS accepts the signature and notarisation without
asking them to bypass Gatekeeper. If the build is unsigned, the download and About screen say so
before the author opens it.

**Why this priority**: The first launch is the trust boundary. A build that requires a security
workaround is not a release.

**Independent Test**: Sign and notarise a fixture build with a staging Developer ID, download it in a
clean macOS user account, and open it with Gatekeeper enabled. Repeat with an unsigned fixture and
confirm the label appears before launch.

**Acceptance Scenarios**:

1. **Given** a signed and notarised build, **When** the author opens it on a clean Mac, **Then** the
   app launches without a Gatekeeper override and About shows the signed status.
2. **Given** an unsigned fixture build, **When** the author opens its download page or About, **Then**
   the build is marked unsigned and the release notes say it is for informed testers only.
3. **Given** a signing identity that is missing, expired or for the wrong team, **When** a release is
   requested, **Then** the release fails closed rather than silently publishing an unsigned build.
4. **Given** a signed build with an invalid signature after download, **When** macOS checks it, **Then**
   the app refuses to launch and the release record identifies the bad artifact.

### User Story 2 - Audit exactly what shipped (Priority: P1)

A maintainer or tester can identify an artifact by version, commit, schema version, platform,
architecture, checksum, signing identity and the gates that passed.

**Why this priority**: Without provenance, a bug report about "the download" cannot be tied to code or
to a capability set.

**Independent Test**: Take a release record and its artifact, verify the checksum and signature, and
compare the version/commit shown in About with the record. Introduce one changed byte and confirm the
verification fails.

**Acceptance Scenarios**:

1. **Given** a published artifact, **When** the maintainer verifies its SHA-256 and signature, **Then**
   both match the release record.
2. **Given** a release record, **When** it is compared with About, **Then** version, commit, schema
   version, platform and capability differences agree.
3. **Given** a build that includes a credential, source map or unexpected environment file, **When**
   the release scan runs, **Then** publication stops and names the file class without printing the
   secret.

### User Story 3 - Update safely, only when enabled (Priority: P2)

After the author accepts an update policy, the app checks a static signed feed, offers a compatible
update, verifies it, installs atomically and keeps the previous version available. The library is
never rewritten by the updater.

**Why this priority**: Updates are the highest-risk distribution feature and must remain off until
the policy is decided.

**Independent Test**: With updates enabled in a staging build, offer a signed newer version, install
it, verify the library checksum is unchanged, then offer a bad signature and confirm the old version
still runs. Repeat with updates disabled and confirm no update request is made.

**Acceptance Scenarios**:

1. **Given** updates are disabled, **When** the app starts or the author opens Settings, **Then** no
   update request is made and the UI says updates are off.
2. **Given** updates are enabled and a compatible signed release exists, **When** the author accepts,
   **Then** the download is verified before installation and the previous version remains available.
3. **Given** an update with a bad signature, wrong hash, downgrade, incompatible schema or unsupported
   OS, **When** it is checked, **Then** it is refused with a specific reason and the current app stays
   running.
4. **Given** an update while the app is running from a read-only location or the disk is full, **When**
   installation is attempted, **Then** it stops before modifying the installed app and explains how to
   recover.
5. **Given** a successful update, **When** the app reopens the last library, **Then** chapter bytes,
   identities and conflicts are unchanged; only the application build differs.

### User Story 4 - Recover from a bad release (Priority: P2)

A bad update is rolled back to the previous known-good artifact without rebuilding, and the author is
told what changed.

**Why this priority**: A release cannot be a one-way door when the manuscript is involved.

**Independent Test**: Publish a deliberately broken staging update, roll back, verify the previous
version launches and opens the same fixture library, and confirm the release record names the rollback.

**Acceptance Scenarios**:

1. **Given** a failed or withdrawn release, **When** the previous artifact is restored, **Then** the
   update feed and download page point to it and the app reports the previous version.
2. **Given** a rollback, **When** the author opens the library, **Then** no manuscript file is migrated
   or rewritten.
3. **Given** a schema that is newer than the rolled-back app, **When** the app opens the library,
   **Then** it refuses with a migration-required message rather than damaging the files.

### User Story 5 - Test without a production certificate (Priority: P1)

A contributor can produce an unsigned fixture build, run the packaging and update-refusal tests, and
share the artifact with informed testers without pretending it is a signed release.

**Why this priority**: The hackathon cannot be blocked on an Apple certificate, but testers still need
honest labels.

**Independent Test**: Build without signing variables and confirm the artifact is produced, About and
the release record mark it unsigned, and the signed-update tests skip with an explicit reason.

**Acceptance Scenarios**:

1. **Given** no signing variables, **When** the release command runs in unsigned mode, **Then** it
   produces an artifact and a record marked unsigned.
2. **Given** an unsigned artifact, **When** the update path is tested, **Then** the updater refuses to
   treat it as a trusted update.
3. **Given** a CI job without certificates, **When** the test suite runs, **Then** signature tests are
   skipped with a reason, not failed or silently passed.

## Edge Cases

- Developer ID certificate expired, revoked or issued to a different team.
- Notarisation service timeout, rejection, or a hardened-runtime entitlement that blocks a legitimate
  feature.
- The app is downloaded through a browser that quarantines it; stapling must survive offline.
- A release is rebuilt instead of promoted, producing a different hash for the same version.
- The update feed is stale, replayed, truncated or signed by an unknown key.
- The update is a downgrade, a schema downgrade, or a build with a newer schema than the app.
- Two app instances run while an update is staged.
- The app lives in `/Applications` but the user lacks write permission; the app runs from a read-only
  disk image.
- The disk fills during download, verification or installation.
- The author is offline, behind a proxy, or on a metered connection.
- An old release note is cached after a rollback.
- A Windows or Linux artifact is present but unsigned; it must be labelled, not treated as macOS.

## Requirements *(mandatory)*

### Signing and notarisation

- **FR-001**: Release signing MUST be configuration-driven and MUST read credentials only from the
  release environment's secret store. No certificate, password, API key or notarisation credential may
  be committed, logged, embedded in an artifact or written to a release note.
- **FR-002**: A signed macOS build MUST use a Developer ID Application identity, hardened runtime, a
  secure timestamp and the smallest entitlement set the app needs.
- **FR-003**: A release build MUST be notarised by Apple, stapled, and verified with `codesign`,
  `spctl` and `stapler` before publication.
- **FR-004**: An unsigned build MUST be an explicit mode, available only when signing is not
  configured. It MUST be labelled unsigned in About, the download page and release notes, and MUST NOT
  be presented as a public release.
- **FR-005**: If signing is expected but the identity, notarisation or verification fails, the release
  MUST fail closed; it MUST NOT fall back to an unsigned artifact automatically.
- **FR-006**: The release record MUST include the artifact SHA-256, signing identity/team, notarisation
  result, commit, version, schema version, platform, architecture and the gates that ran.
- **FR-007**: The release checklist MUST verify that the downloadable artifact is the promoted artifact,
  not a rebuild, and that the checksum in the record matches the bytes served.

### Release integrity

- **FR-010**: Published artifacts MUST NOT contain credentials, `.env` files, source maps, author
  manuscripts, real account identifiers or development certificates.
- **FR-011**: A release MUST publish checksums and notes that name the commit, version, schema,
  capability differences and any unsigned status.
- **FR-012**: A release MUST be reproducible from the recorded commit and build inputs; if the build is
  not reproducible byte-for-byte, the record MUST say which inputs are not pinned.
- **FR-013**: A release record MUST survive independently of the build machine and MUST be available
  with the download.
- **FR-014**: A release MUST be blocked by any failing spec 012 gate, unless a waiver names a reason,
  an owner and an expiry.

### Update path, gated by D-115

- **FR-020**: Auto-update MUST be disabled by default until D-115 is accepted. Disabled means no
  update check, no update request and no background metadata fetch.
- **FR-021**: When enabled, the update manifest MUST be fetched over HTTPS from a static location and
  MUST contain version, commit, schema version, platform, architecture, minimum OS, artifact URL,
  SHA-256, release channel, publication time and a signature over the manifest.
- **FR-022**: The updater MUST verify the manifest signature, artifact hash, platform, architecture,
  minimum OS, channel and schema compatibility before installing.
- **FR-023**: The updater MUST refuse downgrades, replayed manifests, unknown signing keys, unsigned
  artifacts, incompatible schemas and unsupported operating systems, with distinct reasons.
- **FR-024**: Installation MUST be atomic at the application level. A failed download, verification or
  install MUST leave the previous application runnable.
- **FR-025**: An update MUST NOT modify the library, `.studio/`, credentials, drafts or open documents.
  It MUST NOT run a migration automatically; a newer schema MUST require the normal migration flow.
- **FR-026**: The app MUST NOT restart, install or replace itself silently. The author must see the
  version and choose to update, and the app must refuse to update when running from a read-only
  location or without enough free space.
- **FR-027**: Update checks and failures MUST be logged with version/commit and a reason, never with
  manuscript text, a credential or a full URL containing a secret.
- **FR-028**: The previous known-good application version MUST remain addressable for the rollback
  window defined by spec 013.

### Testing and observability

- **FR-030**: Manifest parsing and refusal rules MUST have unit tests for good, stale, replayed,
  downgrade, wrong key, wrong hash, wrong platform, incompatible schema and unsupported OS cases.
- **FR-031**: A signed staging build MUST have an integration test that verifies signature, notarisation,
  stapling and the release record. Without signing credentials, the test MUST skip with a clear reason.
- **FR-032**: An unsigned fixture build MUST be tested for the signed-update refusal and the visible
  unsigned label.
- **FR-033**: A failed update MUST be tested for application preservation, library checksum preservation,
  disk-full and read-only-location failure.
- **FR-034**: A release check MUST scan the artifact and release notes for credentials, source maps and
  manuscript-like content.
- **FR-035**: The update path MUST expose enough state for diagnostics: disabled, checking, available,
  downloading, verifying, ready, installing, failed, rolled-back. It must not claim progress it cannot
  measure.

### Key Entities

- **ReleaseArtifact**: an immutable desktop or web artifact identified by version, commit, platform,
  architecture, schema, size and SHA-256.
- **SignatureRecord**: signing identity/team, certificate validity, notarisation result and stapling
  verification.
- **UpdateManifest**: signed metadata describing one candidate update and its artifact.
- **UpdateAttempt**: requested version, current version, channel, refusal/success reason, bytes and
  timing, with no manuscript or credential data.
- **ReleaseRecord**: artifacts, checksums, signatures, gates, waivers, capability differences and
  notes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed, notarised macOS build opens on a clean Mac with Gatekeeper enabled in 100% of
  release tests.
- **SC-002**: An unsigned build is labelled unsigned in About, the download page and the release notes
  in 100% of unsigned releases.
- **SC-003**: The release record's SHA-256 and signature verify against the published artifact in 100%
  of releases.
- **SC-004**: No release artifact contains a credential, source map, `.env` file or author manuscript;
  the release scan reports zero findings.
- **SC-005**: With updates disabled, the app makes zero update requests in an instrumented run.
- **SC-006**: With updates enabled, bad signature, bad hash, downgrade, schema incompatibility and
  read-only-location cases are refused in 100% of tests, with the current app still usable.
- **SC-007**: A successful update leaves the fixture library byte-identical and the previous version
  available for rollback.
- **SC-008**: A rollback restores the previous app and opens the same fixture library without a library
  migration.
- **SC-009**: A tester can identify the running build's version, commit, schema, platform, signing
  status and release channel from About in under one minute.
- **SC-010**: Release notes and logs contain no credential or manuscript text in 100% of release runs.

## Assumptions

- Spec 013 produces immutable desktop and web artifacts, names them and defines staging/promotion.
- D-115 remains deferred during the hackathon; unsigned builds are the shipping path and updates stay
  disabled. This spec is ready to implement when the decision changes.
- A macOS Developer ID certificate and notarisation credentials may be absent in the hackathon
  environment. Tests that need them skip with a reason; they do not fabricate trust.
- The update feed, when enabled, is static HTTPS storage controlled by the author or maintainer. There
  is no studio account, hosted library or telemetry service.
- The app is installed in a user-writable location for updates; running from a read-only disk image is
  a supported read-only case, not an update case.

## Non-Goals

- App Store distribution, Mac App Store receipts or sandboxing for the App Store.
- Windows Authenticode, Linux repository signing or mobile store distribution in v1.
- Delta updates, staged rollout percentages, remote kill switches or a hosted update service.
- Silent/forced updates, background update checks before D-115, or an update that touches the library.
- Bypassing Gatekeeper, disabling SIP or asking testers to remove quarantine manually.
- Reproducible-build work beyond documenting which inputs are pinned.

## Dependencies and Open Decisions

- **D-115** is deferred and blocks signing, notarisation and the update channel. Until accepted, this
  spec stays drafted and the unsigned path in spec 013 remains the release path.
- Spec 013 supplies artifact names, staging promotion and rollback.
- Spec 012 supplies the release gates, secret scan, signature test seam and failure evidence.
- Spec 011 supplies the credential storage that an update must not touch.
- Trigger to revisit D-115: a public download page or the first external macOS tester.
