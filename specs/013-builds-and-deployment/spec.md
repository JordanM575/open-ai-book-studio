# Feature Specification: Builds and deployment

**Feature Branch**: `013-builds-and-deployment`
**Status**: Draft
**Input**: User description: "I want multi deployment, so builds an electron app, then builds the web app. So we might have a few different components and folders would need to separate where they share same core the web app expects to look and reuse UI, but then electron gets wrapped."

## Overview

One product, two distributions. The same commit produces a desktop application and a web application
from shared packages: the core that owns the book format and the interface that owns the design. The
desktop app wraps them with filesystem access, protected storage and a Chromium window; the web app wraps
them with browser storage. Neither is a fork of the other.

This specification defines the repository layout, the build and release process, the environment and
capability rules, and the staging path for the hackathon.

## Clarifications

### Session

- Q: What is shared? → A: `packages/core` (schema, format, library logic, agent tools) and `packages/ui`
  (components, screens, tokens). Applications contain only entry points, platform adapters and
  platform-specific wiring.
- Q: Is the web build an afterthought? → A: No, but it is the limited build. It supports the same book
  format and the same interface; it does not promise desktop durability or desktop-only providers.
- Q: Is there a backend? → A: No. The web build is static assets. Bun serves them in development and can
  serve them in production, but there is no application server holding accounts, prose or keys.
- Q: Which desktop platforms? → A: macOS is the reference and the only one required for the hackathon
  demo. Windows and Linux packaging is configured and built in CI but does not block the first release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build both targets from one commit (Priority: P1)

A maintainer checks out a tag, runs one command, and gets a web bundle and a desktop application that
report the same version and commit.

**Why this priority**: Two builds that drift are two products, and the book format promise fails the
first time they disagree.

**Independent Test**: Build both from a clean checkout, open the same library with each, and compare the
version string and the chapter files.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the build command runs, **Then** both builds succeed and print the
   version and commit they were built from.
2. **Given** a book created in the desktop build, **When** it is opened as a folder in the web build,
   **Then** all chapters and planning data are present and editable.
3. **Given** a web-exported library archive, **When** it is imported in the desktop build, **Then**
   identities and text are unchanged.

---

### User Story 2 - Run and deploy the web build (Priority: P1)

A contributor runs the web build locally with Bun, and a release deploys the same static assets to a
staging URL. The app works in current Chrome, Safari and Firefox, with the storage tier each browser
supports.

**Why this priority**: Hackathon judges may only click a link. That path must be first class.

**Independent Test**: Run the local web command, complete the primary journey in each browser, then deploy
the same commit to staging and repeat.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the contributor runs the web dev command, **Then** the app loads
   and a demo library can be opened without a server account.
2. **Given** the production web bundle, **When** it is served by a static host, **Then** deep links resolve
   through the single-page fallback and no request is made to a build-time API host.
3. **Given** Safari or Firefox, **When** the author opens the app, **Then** it uses origin-private storage
   and says so, and exporting an archive is one click away.

---

### User Story 3 - Package the desktop application (Priority: P1)

A maintainer produces a macOS application that opens the real library, stores credentials in protected
storage, and can be handed to a judge without a terminal.

**Why this priority**: The desktop build is the complete product and the demo that shows the agent editing
files the author owns.

**Independent Test**: Build the macOS package, install it in a clean user account, connect a provider, open
a book on disk and edit it.

**Acceptance Scenarios**:

1. **Given** a packaged build, **When** it launches, **Then** it shows the welcome screen, not a blank
   window or a developer error.
2. **Given** a packaged build, **When** the author chooses a folder, **Then** files are written to that
   folder with the same format as the development build.
3. **Given** an unsigned development package, **When** it is shared, **Then** its unsigned status is stated
   in the release notes and it is not presented as a public download.

---

### User Story 4 - Stage a hackathon release (Priority: P1)

The maintainer promotes a commit through staging, runs the release gates, and publishes a web URL and a
desktop artifact with notes that match what is actually in the build.

**Why this priority**: A hackathon has one shot; staging is how a broken build is found before judges do.

**Independent Test**: Promote a commit to staging, run the checklist, then promote the same commit to the
public demo and verify the version string.

**Acceptance Scenarios**:

1. **Given** a candidate commit, **When** staging deploys, **Then** the staging URL reports the commit and
   version, and the demo library opens.
2. **Given** a passing staging run, **When** the public demo is updated, **Then** the same artifact is
   promoted rather than rebuilt.
3. **Given** a failing gate, **When** promotion is attempted, **Then** it stops and names the gate.

---

### User Story 5 - Know what shipped (Priority: P2)

A support conversation can start with "which build?" and end with the exact commit, provider capability
set and schema version.

**Why this priority**: Without it, a bug report about "the demo" is unactionable.

**Independent Test**: Open About in both builds and confirm version, commit, schema version and platform
are shown; compare with the release record.

**Acceptance Scenarios**:

1. **Given** any build, **When** the author opens About, **Then** it shows version, commit, schema version,
   platform and the licence.
2. **Given** a release, **When** the maintainer opens its notes, **Then** the commit, artifact checksums and
   capability differences from the previous release are listed.

---

### User Story 6 - Roll back (Priority: P2)

A bad demo build is replaced by the previous known-good artifact without rebuilding, and the web URL and
desktop download both return to it.

**Why this priority**: A hackathon demo cannot spend twenty minutes rebuilding.

**Independent Test**: Deploy a deliberately broken build, roll back, and verify the previous version is
served in under five minutes.

---

### User Story 7 - Keep build capabilities honest (Priority: P2)

The web build does not show ChatGPT plan sign-in or providers that browsers cannot reach; the desktop
build shows them. The differences come from one capability description, not from scattered conditionals.

**Why this priority**: A button that cannot work is worse than an absent button, and duplicated platform
checks drift.

**Independent Test**: Build both, open model access in each, and compare against the documented capability
matrix; a test fails if they disagree.

## Edge Cases

- The web build is served from a subpath rather than the domain root.
- A browser blocks third-party storage or runs in a private window.
- The desktop build is opened on a machine without the provider's browser installed.
- A build machine lacks signing identities; the build must still produce a usable unsigned artifact.
- The disk fills during packaging.
- Node and Bun versions differ between local and CI.
- The web build's static host serves an old cached asset after a deploy.
- A release is promoted while a previous deploy is still propagating.
- The schema version advances and an older web tab is still open.
- A provider capability is enabled in the web build without a passing browser-access test.
- An Electron auto-update is attempted while the app is running from a read-only location.
- A source map is accidentally published with the web build.

## Requirements *(mandatory)*

### Repository shape

- **FR-001**: The repository MUST be a Bun workspace with `apps/desktop`, `apps/web`, `packages/core`,
  `packages/ui` and `packages/config`.
- **FR-002**: `packages/core` MUST contain the schema, format, library logic, conflict policy and agent
  tools, and MUST NOT import Node, Electron, DOM or browser APIs.
- **FR-003**: `packages/ui` MUST contain the React components, screens, styles and generated tokens, and
  MUST NOT import Node, Electron or filesystem APIs.
- **FR-004**: `apps/desktop` MUST contain only Electron main, preload, renderer entry and desktop adapters.
- **FR-005**: `apps/web` MUST contain only the web entry, router and web adapters.
- **FR-006**: Applications MUST consume packages by package name, never by reaching into another
  package's source tree.
- **FR-007**: Platform capability differences MUST be expressed in one shared capability description used
  by both applications, not by scattered environment checks.

### Builds

- **FR-008**: One documented command MUST build both applications from a clean checkout.
- **FR-009**: Each build MUST embed its semantic version, commit identifier and schema version, and expose
  them in About.
- **FR-010**: The web build MUST produce static assets with relative URLs, a single-page fallback and a
  content security policy that allows only registered provider hosts and the app origin.
- **FR-011**: The web build MUST work when served from a subpath.
- **FR-012**: The desktop build MUST package Electron with context isolation, sandboxing, no Node
  integration in the renderer and a preload bridge.
- **FR-013**: The desktop build MUST be configurable for macOS, Windows and Linux, with macOS as the
  release-blocking platform for the hackathon.
- **FR-014**: Builds MUST NOT contain credentials, environment files or source maps in publicly served
  assets.
- **FR-015**: Signing and notarisation MUST be configurable; an unsigned build MUST identify itself as
  unsigned in About and release notes. Spec 009 owns the signing, release-record and notarisation
  contract.
- **FR-016**: The build MUST fail if a required asset, preload script or migration file is missing, rather
  than produce an application that fails at launch.
- **FR-017**: The desktop build MUST include the hidden smoke mode used by automated verification, and the
  web build MUST include a test-mode entry that does not alter production behaviour.

### Environments and deployment

- **FR-018**: Staging and production MUST be separate deployments of immutable artifacts, promoted rather
  than rebuilt.
- **FR-019**: The web deployment MUST be reproducible from a commit and MUST serve the exact artifact that
  passed the gates.
- **FR-020**: A deployment MUST be reversible to the previous artifact in under five minutes.
- **FR-021**: Environment-specific values MUST be injected at build or serve time, MUST be documented and
  MUST NOT include secrets for the web build.
- **FR-022**: The web build MUST NOT require a backend service, account, database or proxy to open and
  write a book.
- **FR-023**: The desktop release MUST publish a macOS artifact, checksums and release notes that name the
  commit and the capability differences.
- **FR-024**: Auto-update MUST be configured but disabled for the hackathon build; enabling it later MUST
  NOT require changing the package layout. Spec 009 owns the manifest, verification and rollback
  contract; D-115 gates enabling it.
- **FR-025**: Deployment logs and release notes MUST NOT contain credentials or manuscript text.

### Capability and honesty

- **FR-026**: The web build MUST enable only the storage adapters and provider connections verified for
  browsers, and MUST show the reason for anything disabled.
- **FR-027**: The desktop build MUST enable every connection and storage capability in its specification.
- **FR-028**: A release checklist MUST include the provider capability matrix and a manual check that each
  enabled connection completes a request.
- **FR-029**: About MUST state which build (desktop or web), which platform, which storage tier and which
  capabilities are active.
- **FR-030**: The same book MUST open in both builds without conversion, and an archive exported from one
  MUST import into the other.

### Staging path

- **FR-031**: The hackathon path MUST define three stages: local, staging, public demo.
- **FR-032**: Promotion from local to staging MUST require the required gates; promotion to public demo
  MUST require the same gates plus a completed manual checklist.
- **FR-033**: A public demo MUST use synthetic or author-approved content only, never a real manuscript.
- **FR-034**: The demo library MUST be resettable in one action without touching any real library.
- **FR-035**: The public web demo MUST disclose that it stores the library in the browser and may be
  cleared.

### Key Entities

- **Workspace package**: an application or shared package with a name, an entry point and a rule about what
  it may import.
- **Build artifact**: an immutable web bundle or desktop package identified by version and commit.
- **Environment**: local, staging or public demo, with its own URL, storage expectations and capability
  set.
- **Capability**: a build-level statement that a feature is available here, with a reason when it is not.
- **Release record**: commit, version, checksums, gates, waivers, capability differences and notes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clean checkout builds both applications in under 10 minutes on the reference machine.
- **SC-002**: The initial web bundle stays under 350 KB compressed and the app becomes interactive in under
  3 seconds on a typical laptop.
- **SC-003**: The packaged macOS application launches to the welcome screen on a clean user account in
  100% of release tests.
- **SC-004**: A book created in either build opens in the other with identical text and identities in 100%
  of tests.
- **SC-005**: A staging deployment of a commit completes in under 10 minutes; a rollback completes in under
  5 minutes.
- **SC-006**: A secret scan of both artifacts finds zero credentials in 100% of releases.
- **SC-007**: The web build completes the primary journey in current Chrome, Safari and Firefox.
- **SC-008**: About shows version, commit, schema version, platform and storage tier in both builds, and
  matches the release record.
- **SC-009**: Every capability difference between desktop and web is listed in one matrix and enforced by
  one test.
- **SC-010**: The public demo can be reset to a known state in one action, leaving no author data behind.

## Assumptions

- **Runtime**: Electron's main process is Node and is not replaced by Bun; Bun owns installation, scripts,
  tests and the web dev/serve path (ADR 0010).
- **Hosting**: the web build is served as static files from a host of the author's choosing; Bun can serve
  it locally and in staging without becoming an application backend.
- **Build machine**: macOS is the reference build host. Windows and Linux packaging is configured but is
  not required for the first hackathon release.
- **Signing**: a Developer ID certificate may not be available during the hackathon; unsigned builds are
  labelled and shared only with informed testers.
- **Design**: new panels needed for connections, models, usage and the Story Bible are added to the design
  kit first, then implemented in `packages/ui`.
- **Scope**: there is no accounts service, telemetry, hosted sync or server-side rendering in v1.

## Non-Goals (v1)

- Server-side rendering or a hosted multi-tenant service.
- A separate mobile application.
- Auto-update channels for public users during the hackathon.
- App-store distribution.
- Replacing Electron with Electrobun; it remains an evaluated option (ADR 0010).
