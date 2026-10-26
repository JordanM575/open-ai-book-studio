# Feature Specification: Browser target — local libraries and portable storage

**Feature Branch**: `015-web-target` (reserved roadmap slot: 010)

**Created**: 2026-10-24

**Status**: In progress

**Input**: Continue the iPhone/iPad-first roadmap by implementing the browser target that the real renderer and Capacitor shell depend on. Preserve the local-first file format, checked saves, conflict copies, privacy and existing mobile layouts.

## Overview

The author can use AI Book Studio in a browser without installing an application. A browser that grants access to a chosen folder works with the author's ordinary library files. A browser without folder access keeps a library in that site's browser storage and says plainly that the library is tied to the browser profile. In either case the author can export and import a portable library archive to move work between browser and desktop builds.

The browser target uses the same book format, save protocol, conflict rules and responsive studio as the desktop target. It does not promise desktop durability: browser storage may be cleared or evicted, and an abruptly killed tab may lose text that had not completed a save. Provider requests go directly to the provider only after the author asks the writing agent to work.

This specification expands spec 002 User Story 10 and FR-071…FR-076, and supplies the browser-runtime and storage prerequisites for spec 013's web shell/build and spec 014's Capacitor shell. It does not relax the stronger desktop guarantees.

## User Scenarios & Testing

### User Story 1 — Open and write a library in a browser (Priority: P1)

An author opens the web studio on a machine where installing an application is not possible, opens or creates a library, and writes in the same interface and book format as the desktop application.

**Why priority**: This is the browser target's primary value and the prerequisite for loading the real renderer in Capacitor.

**Independent Test**: Serve a production build over HTTPS, create a book and chapter, write text, reload the page, and confirm the saved file and text are still present. Repeat in a browser with folder access and a browser using site storage.

**Acceptance Scenarios**:

1. **Given** a secure browser that offers user-selected folder access, **When** the author chooses a library folder, **Then** the studio opens the same ordinary library files used by desktop and explains when the browser needs permission again.
2. **Given** a browser without folder access, **When** the author chooses browser storage, **Then** the studio creates a library in that browser profile and identifies the storage location as this site and browser, not a folder on the author's device.
3. **Given** a saved chapter, **When** the author reopens the same folder or browser library after a normal restart, **Then** the chapter remains available with the same book and chapter identities.
4. **Given** the web application is opened in a supported phone or tablet viewport, **When** the author opens a book, **Then** the responsive layout from spec 014 remains usable without horizontal page scrolling.

---

### User Story 2 — Know when a save is safe and recover from browser limits (Priority: P1)

An author sees whether a save has completed, can retry after permission or storage errors, and is not told that browser storage is as durable as desktop files.

**Why priority**: The weaker browser storage guarantees must be honest; a false “Saved” state can cost an author work and trust.

**Independent Test**: Deny and revoke folder permission, simulate a full or unavailable browser store, and close a tab during a pending save. Confirm the current editor reports the state accurately, offers recovery, and never silently switches storage tiers or overwrites a newer file.

**Acceptance Scenarios**:

1. **Given** a save is in progress, **When** the write has not completed, **Then** the UI does not report it as saved.
2. **Given** permission is denied or revoked, **When** a write or reopen is attempted, **Then** the studio explains how to grant access again, keeps the current in-memory text available while the page remains open, and does not silently copy the library to another storage tier.
3. **Given** the browser store is full or unavailable, **When** a save fails, **Then** the prior complete file remains intact, the error says what failed, and the author can retry or export available saved work.
4. **Given** the author closes or the browser kills a tab before a pending save completes, **When** the library is reopened, **Then** the studio reports only text confirmed on the storage adapter as saved; it does not claim that every keystroke survived.
5. **Given** a second tab or another writer changes a chapter, **When** this tab saves an older base version, **Then** the normal version/hash check creates a conflict copy and shows both versions rather than overwriting the newer text.

---

### User Story 3 — Move a whole library between builds (Priority: P1)

An author exports a browser library as a portable archive, imports it into desktop or another browser storage tier, and continues with the same books and chapters.

**Why priority**: Browser storage is site- and profile-bound; an export is the author's recovery and migration path.

**Independent Test**: Export a fixture library containing multiple books, Markdown chapters, planning data, images, conflicts and trash; import it into a fresh destination in another build; compare the included file hashes and identities.

**Acceptance Scenarios**:

1. **Given** a library, **When** the author exports it, **Then** the archive contains all format-defined author data and source files while excluding credentials, disposable catalog data, temporary files and per-install device identity.
2. **Given** a valid archive, **When** the author imports it into a new or empty destination, **Then** books, chapters, planning data, files and identities are preserved and the imported library can be opened immediately.
3. **Given** an archive is corrupt, has an unsupported future format, contains an unsafe path, exceeds stated size limits, or fails a file-hash check, **When** import is attempted, **Then** the import is rejected before it can overwrite an existing library and the author is told how to recover.
4. **Given** import fails after writing begins, **When** the operation stops, **Then** no existing library file has been replaced; partial staging data is removed or clearly identified for safe cleanup.
5. **Given** two libraries contain the same book identity, **When** the author imports one, **Then** the studio never merges or replaces the open library silently; import is into a separate destination.

---

### User Story 4 — Use browser-approved model access without a server copy (Priority: P1)

An author connects a provider that is approved for direct browser access, understands where the credential is kept, and asks the writing agent to work with selected book content.

**Why priority**: The browser target must retain the product's no-custody promise and must not imply that every desktop provider works from a browser.

**Independent Test**: Connect the verified browser provider, inspect network requests and library exports, run one requested turn, then forget the connection. Confirm requests go only to the provider, secrets are absent from the library/archive/URL/logs, and unsupported providers are unavailable with a reason.

**Acceptance Scenarios**:

1. **Given** a provider has not passed the direct-browser access check, **When** the author opens Connections or the model picker, **Then** the provider cannot be used and the interface explains that it is not available in this browser build.
2. **Given** a browser-supported connection, **When** the author connects, **Then** the studio states that the credential is stored in this browser profile and never in a book or archive.
3. **Given** an author asks the writing agent to work, **When** a request is sent, **Then** it goes directly from the browser to the selected provider; no studio server or proxy receives the key or prose.
4. **Given** the author forgets a connection, **When** removal completes, **Then** the browser vault no longer returns the credential and the studio makes no later request using it.

## Edge Cases

- The page is served from an insecure or opaque origin, so local browser storage or a folder picker is unavailable.
- The author cancels the folder picker, denies access, or grants read-only access when writes are needed.
- A stored directory handle remains in the browser profile but permission has been revoked after restart.
- A browser clears site data, evicts origin storage, denies a persistence request, or reaches its storage quota.
- A device sleeps, a tab is suspended, or the browser is killed while the editor has an uncommitted draft.
- Two browser tabs open the same library; a writer lock is unavailable or held by a crashed tab.
- A folder is removed or a sync provider replaces a chapter between read and save.
- A file is too large, malformed, read-only, or ahead of the running app's schema version.
- An archive contains duplicate paths, path traversal, a symlink, a forged manifest, a zip bomb, unsupported compression, or a partial stream.
- A provider request is blocked by CORS, the author revokes a key, or the browser goes offline during an agent turn.
- A browser update changes permission or storage behavior between sessions.

## Requirements

### Functional Requirements

- **FR-001**: The browser target MUST use the same library format, canonical Markdown rules, IDs, version/hash save protocol, conflict copies and trash policy as desktop (002 FR-071; D-009).
- **FR-002**: Where the browser offers secure, user-initiated access to a chosen folder, the author MUST be able to choose and reopen that folder subject to the browser's permission rules. The studio MUST NOT rely on browser-name sniffing to claim that this capability exists.
- **FR-003**: Where chosen-folder access is unavailable, the author MUST be able to keep a library in site-owned browser storage, and the UI MUST identify the site/profile boundary before the author relies on it (002 FR-073).
- **FR-004**: The studio MUST NOT silently switch an author between a chosen folder and browser storage. A storage-tier change MUST be an explicit open, create, import or export action.
- **FR-005**: Browser-storage creation MUST use the same ordinary directory and file layout as a desktop library. Any catalog or index kept outside those files MUST be derived, rebuildable and disposable (constitution §1; 002 FR-009).
- **FR-006**: The studio MUST request persistent browser storage when the browser offers that choice, report whether the request was granted, and never describe that request as a backup or guarantee against user clearing or browser failure.
- **FR-007**: Save status MUST distinguish pending, saved, conflict and failure. A save is “saved” only after the selected adapter confirms the committed file. A failed write MUST leave the prior complete file intact and explain the next safe action (002 FR-026, FR-066…FR-068; F-014).
- **FR-008**: Every browser save MUST compare the version and hash the author started from with the current file. A mismatch MUST preserve the author's text as a conflict copy and show both versions; the browser target MUST NOT silently overwrite a different writer's text (002 FR-071; D-009).
- **FR-009**: The browser target MUST attempt a final flush on page hide where the browser permits it, but MUST describe this as best effort. It MUST NOT claim that text survives a forced tab or browser termination unless the storage adapter confirmed the write.
- **FR-010**: When multiple browser contexts can write one library, the target MUST use an available storage lock or show a warning that it cannot guarantee single-writer access. Version/hash conflict checks remain mandatory even when a lock is used.
- **FR-011**: The author MUST be able to export a whole library archive and import it into a separate destination in desktop and browser builds (002 FR-056, FR-076). Import MUST preserve book and chapter identities and all format-defined author files; it MUST NOT merge with or replace an existing library silently (F-018).
- **FR-012**: Archive import MUST validate the manifest, normalized relative paths, supported format/schema versions, no more than 10,000 entries, no more than 2 GiB expanded total or 512 MiB per file, available destination capacity, and all file hashes before publishing an imported library. It MUST exclude credentials, derived indexes/catalogs, lock files, temporary files and per-install device identity from archive output.
- **FR-013**: Browser credentials MUST be kept in origin storage with an explicit disclosure, removed by the “Forget” action, and never written into the library, logs, URLs, crash reports or portable archives (002 FR-062…FR-064; 011 US7; D-105; F-006).
- **FR-014**: The browser target MUST call a model provider directly only when the shared provider capability record marks it as available for direct browser access. It MUST NOT add a server proxy that receives credentials or prose (002 FR-075; D-101; F-006).
- **FR-015**: The browser target MUST use the shared provider registry for model capabilities and MUST state when desktop-only features or providers are unavailable (011 FR-020 and web clarifications).
- **FR-016**: The browser target MUST disclose that browser storage has no operating-system keychain, may be cleared or evicted, and cannot guarantee recovery after an unclean tab termination (002 FR-074).
- **FR-017**: At the viewports named in spec 014, the shared interface MUST remain usable without horizontal overflow; the responsive library grid MUST prevent the narrow-window overflow regression (014 FR-001; F-048).
- **FR-018**: The web target MUST run as static application assets. It MUST NOT require a studio account, server-side library, telemetry or background upload (constitution §3; 013 FR-005, FR-010).
- **FR-019**: Runtime errors from missing permissions, unavailable storage, quota exhaustion, unsupported provider or corrupt archive MUST leave the application usable and give the author a specific recovery action (002 FR-067; F-014).

### Non-Goals

- Changing the book or chapter file format, save protocol, conflict policy or desktop durability guarantees.
- Hosting libraries, accounts, credentials, analytics or a model proxy on a studio server.
- Making every model provider available in every browser; provider access is gated by verified browser capability.
- Replacing the desktop credential vault with browser storage or promising browser-key encryption equivalent to OS-protected storage.
- Implementing native iOS file access, iCloud entitlements, Keychain integration, App Store distribution or the Capacitor shell itself; spec 014 and D-117 own those host-specific decisions.
- Redesigning the responsive interface; spec 014 owns mobile layout and touch acceptance.
- Making an opaque database the source of truth or silently merging imported libraries.

## Key Entities

- **Storage tier**: a chosen local folder or the current site's browser storage, with its own durability and permission state.
- **Library handle**: the author's selected library and its access status; it does not expose a trusted filesystem path to the renderer.
- **Save attempt**: content, base version and base hash, followed by a committed, conflict or failure result.
- **Portable library archive**: a manifest and validated set of author-owned library files, with per-file hashes and format versions.
- **Browser connection**: a provider credential kept in origin storage, with a visible storage disclosure and a forget action.
- **Provider capability**: the shared registry's truthful statement of whether a provider can be called directly from this build.

## Success Criteria

- **SC-001**: On a secure browser with chosen-folder support, an author creates or opens a library, saves a chapter, restarts the browser, reopens the folder and sees the saved file and unchanged IDs in 100% of normal-save test runs.
- **SC-002**: On a browser using site storage, an author creates and reopens a library after a normal restart in 100% of non-eviction test runs; the storage disclosure is visible before the first book is created.
- **SC-003**: A round-trip archive fixture with at least 20 books, 120 chapters, images, conflicts and trash imports with every included file hash and book/chapter identity unchanged.
- **SC-004**: Corrupt, unsafe-path, unsupported-version, oversized and hash-mismatched archives are rejected without replacing an existing library in 100% of negative tests.
- **SC-005**: Two tabs editing one chapter cannot silently overwrite a different committed version in 100% of conflict tests.
- **SC-006**: Automated network inspection finds no request to a studio-controlled application server and no provider request before an author explicitly starts an agent turn.
- **SC-007**: Browser storage, provider and import failures show an actionable state without leaving the editor permanently busy or claiming a failed save succeeded.
- **SC-008**: The responsive UI has no horizontal document overflow at iPhone 393 × 852, iPad mini 744 × 1133 and desktop 1440 × 900 (014; F-048).

## Assumptions

- The production web app is served from HTTPS; localhost is acceptable for development. Browser file and origin storage APIs may be unavailable on insecure or opaque origins.
- The adapter is selected by feature detection and author choice, not browser-name checks.
- Existing browser-access evidence in D-101 and spec 011 limits initial direct model use to providers that have passed the check; current evidence verifies OpenRouter only.
- The author can always move a library using a portable archive, even where a browser folder picker is unavailable.
- Static app distribution and build metadata are governed by spec 013; native iOS shell and safe-area behavior are governed by spec 014.
- Existing desktop layouts, save tests and hidden smoke remain regression gates; browser durability is not used to weaken desktop acceptance.
