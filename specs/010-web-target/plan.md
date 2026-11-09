# Implementation Plan: Browser storage and portability

**Branch**: `015-web-target` · **Spec**: [spec.md](spec.md)

## Summary

Implement the shared checked library logic and storage-port boundary promised by ADR 0009; keep Electron's main-process filesystem adapter as the reference; add browser adapters for user-selected folders and origin-private storage; and add a validated, streaming portable-library archive. Browser credentials and OAuth are constrained by ADR 0011 and integrated by spec 011. The `apps/web` UI shell, shared UI extraction, static build and deployment remain in spec 013; this plan provides the storage, archive, capability and runtime contracts that shell consumes. Capacitor safe areas and native iOS behavior remain in spec 014.

## Status

The storage half is implemented. `packages/core` now owns the checked library service, validated
library-relative paths, the storage port, the portable archive and the storage summary. Electron's
main process runs through the filesystem adapter and keeps its existing IPC surface; desktop
export/import are available from the library view. `apps/web` contains the browser directory-handle
port, folder access, OPFS, IndexedDB handle storage, capability detection, cross-tab Web Locks and
archive download/upload.

The browser draft buffer (`apps/web/src/storage/drafts.ts`) now owns the page-hide flush and reports a
`confirmed` / `conflict` / `unconfirmed` / `empty` outcome instead of a bare "saved"; a save only
clears the draft whose text it wrote, so prose typed while a save is in flight stays held.

Still open: the native folder-picker and real Safari/Firefox matrix (T013/T027), the shared UI and
Vite shell owned by spec 013, browser provider credentials owned by spec 011, and the Capacitor shell
owned by spec 014. The earlier audit that found the port unbuilt is historical; this section supersedes it.

## Technical Context

**Language / version**: TypeScript 7; Electron main remains on Electron's Node runtime.

**Primary dependencies**: Existing Zod 4, `ai` 7 and provider registry; add `fflate` as an explicit core dependency for bounded streaming ZIP creation/extraction.

**Storage**: Ordinary library files are authoritative in every target. Electron uses the existing atomic filesystem adapter. Browser folder mode uses the browser's user-granted file-system handles. Browser fallback uses OPFS with IndexedDB only for origin-scoped handles, storage metadata and credentials; it does not store the book as an opaque database record.

**Testing**: Bun tests for core services, in-memory port and archive validation; filesystem-adapter conformance tests in temporary libraries; Playwright on Node for browser/electron end-to-end runs per spec 012; existing hidden Electron smoke remains mandatory.

**Target platform**: Existing macOS Electron build; secure-context web deployment in current Chromium, Safari and Firefox; WKWebView integration is verified as part of spec 014 using the static web target.

**Project type**: Bun workspace with desktop app, shared TypeScript core, browser adapter modules, and the web shell owned by spec 013.

**Performance goals**: Preserve current desktop save/open behavior. Stream archive import/export and avoid buffering an entire archive or expanded library in memory. Support the spec's limits: 10,000 entries, 2 GiB expanded total and 512 MiB per entry, subject to lower destination quota.

**Constraints**: Core must not import Node, Electron or browser APIs. The renderer never gets direct filesystem handles or arbitrary paths. No server-side storage, provider proxy, telemetry, credentials in a library/archive, or silent storage-tier migration. Browser storage is weaker than desktop and must say so.

**Scale / scope**: Three library adapters, one shared library service, archive contract and integration with the browser capability and library UI. No new book format or derived search index.

## Constitution Check

- **Author's files remain the source of truth**: Pass. Browser folder mode uses the same ordinary files; OPFS mode uses the same directory tree and offers a portable archive. Index/handle metadata stays rebuildable.
- **One writer, checked**: Pass with adapter-specific commit behavior. Core retains the base-version/hash check, preserves conflict copies and sends every write through the port. Browser tabs use a lock when available and still run the conflict check.
- **Local-first, no custody**: Pass. Static web assets make direct provider calls only after explicit author action; no studio account, proxy or telemetry.
- **Spec before code**: Pass. This plan follows spec 010, ADRs 0009/0011/0012 and inherited FR/F- citations.
- **Honest interface**: Pass. Storage tier, permission state, save completion and weaker browser guarantees are explicit.
- **Designed, not assembled**: Pass. Storage status is surfaced through the shared token-based UI; no new visual language.
- **Tests at boundaries**: Pass. Core conformance tests plus temporary-folder, browser-storage and archive failure tests; hidden smoke does not touch the author's profile.

No constitution exception is required. Browser credentials remain a disclosed browser-profile risk under ADR 0011 and are never treated as OS-protected secrets.

## Architecture

### Shared library service and port

Extract product invariants from `apps/desktop/src/main/library/store.ts` into `packages/core/src/library/`. The shared service owns layout validation, schema-version checks, catalog rebuilding, chapter parsing, IDs, word counts, baseVersion/baseHash comparison, conflict copies and trash policy. It receives a narrow `LibraryPort` for library-relative byte reads/writes, directory listing, stat, remove/restore, external-change notification, device identity, time, ID generation and hashing. Paths remain relative and validated; no target accepts an arbitrary renderer-supplied absolute path.

The adapter's committed-write operation must leave the previous complete file intact if the write fails. Desktop retains temp-file + fsync + rename. Browser writable streams commit on close; browser implementations use an application lock where available, re-read the current hash before commit, and return observed conflicts rather than pretending a tab-hide flush is durable. Core tests run against an in-memory implementation so the save protocol is exercised once.

### Desktop adapter

Move Node filesystem operations into `apps/desktop/src/main/library/fs-port.ts` and keep `atomic.ts`, path safety, single-instance rules, draft flushing and credential storage in the main process. Route existing IPC handlers through the shared service. Existing IPC schemas and `Result` envelope remain the desktop boundary.

### Browser adapters

- **Folder adapter**: feature-detect secure, user-gesture directory access. Persist only the browser handle in IndexedDB. On each open, request the current permission; denied/revoked access is an actionable state, never a silent switch to a different library.
- **Origin adapter**: create the same folder/file layout under OPFS. Keep a minimal IndexedDB record for library selection/metadata and the separate credential vault. Request persistent storage where offered, report the result and still treat site-data clearing/eviction as possible.
- **Concurrency**: use a browser lock where supported; always retain the normal version/hash check. Watch external changes where a platform offers a useful signal; otherwise re-check at read/commit boundaries and state the limitation.
- **Draft flush**: hold the newest text of each open chapter in a browser draft buffer. A confirmed save removes only the text it wrote; a flush on page hide is best effort and reports `confirmed`, `conflict` or `unconfirmed`, never "saved" for a write that did not land.
- **Agent**: browser tool calls use the same checked library service through the web runtime seam; provider-specific browser access and credential lifecycle remain owned by spec 011. WebWorker hosting and the actual static app entry are wired by spec 013.

### Portable library archive

Keep the manifest schema, path normalization and archive invariants in `packages/core`. Use `fflate` streaming `Zip`/`Unzip` APIs; platform adapters supply file bytes and download/picker destinations. Validate archive format version, normalized relative paths, duplicates, declared and actual sizes, entry count, hashes and all book schema versions before any live-library publish. Import only into a new library or empty destination. Exclude `library.json`, `.studio/device.json`, temporary/lock files and credentials; preserve all other files, including unknown files, conflicts, trash, images and future format-defined data.

### Cross-spec ownership

- **Spec 010**: core library port/service; desktop adapter migration; FSA/OPFS adapters; archive contract and import/export services; adapter tests and truthful storage/capability data.
- **Spec 011**: browser OpenRouter callback, IndexedDB credential vault and provider UI, using D-101/D-104/D-105; unsupported providers stay unavailable.
- **Spec 013**: shared UI extraction, `apps/web` entry/Vite output, build metadata, static-host behavior and promotion. It consumes the ports/adapters defined here.
- **Spec 014**: Capacitor shell and native iOS storage, protected credentials, lifecycle, permissions and capability/refusal integration. It consumes the shared port/capability contracts and spec 013's real renderer; native decisions and target evidence remain separate.

## Project Structure

```text
packages/core/src/library/
  port.ts                 LibraryPort and adapter result types
  path.ts, paths.ts       validated library-relative paths and format layout
  service.ts              shared library operations and save/conflict rules
  storage.ts              storage summary and honest browser warnings
packages/core/src/archive/
  manifest.ts, export.ts, import.ts, errors.ts
apps/desktop/src/main/library/
  fs-port.ts              Node filesystem adapter around the existing atomic writer
  store.ts                thin facade over the shared service
  archive.ts              desktop archive file/picker bridge
apps/desktop/tests/
  library.test.ts, archive-io.test.ts
apps/web/src/storage/
  directory-port.ts       one port over a folder handle or OPFS directory
  fsa.ts                  selected-folder picker and permission recovery
  opfs.ts                 origin-private layout, persistence and quota
  indexeddb.ts            handles/library id only (credentials remain spec 011)
  capabilities.ts         feature detection
  archive-io.ts           browser save-picker/download and File import
  drafts.ts               browser draft buffer, page-hide flush and honest outcome
apps/web/tests/storage/
  directory-port.test.ts, archive-io.test.ts, drafts.test.ts
apps/web/check/            real-browser OPFS/conflict/archive harness
specs/010-web-target/
  spec.md, plan.md, tasks.md, research.md, data-model.md
  contracts/library-port.md, contracts/archive-v1.md, quickstart.md
```

**Structure Decision**: Keep product policy and schemas in `packages/core`; keep Node/browser primitives in each app's adapter folders. This follows ADR 0009 and avoids a fourth shared package until an actual consumer needs one. The Vite entry and UI extraction stay in spec 013.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Refactoring the writer changes conflict/trash behavior | First add port tests against current store behavior; preserve all existing tests; migrate only after in-memory conformance passes. |
| Browser permission is lost between sessions or mid-save | Show permission state; never change storage tier automatically; do not report a write saved until commit resolves; preserve/retry the live editor buffer. |
| Site storage is cleared or evicted | Warn at library creation/open, request persistence where available without promising it, and keep export visible. |
| Two tabs or sync provider change files concurrently | Browser lock where available, hash recheck, conflict copy on observed mismatch, no merge or silent selection. D-111 provider-specific conflict naming remains separate. |
| Large or malicious archive consumes memory/disk or writes outside destination | Streaming parser, explicit entry/expanded-size limits, normalized paths, hash verification, preflight quota check, isolated new destination and adversarial tests. |
| Browser provider API is blocked by CORS | Registry-gated direct access; do not ship a proxy; only a provider that passed D-101 is enabled. |
| Vite UI/build work overlaps specs 013 and 014 | Keep ownership split above; update 013 task notes to consume spec 010 outputs and 014 tasks to consume the static bundle. |

## Verification

- `bun run typecheck`, `bun test`, `bun run build`, and `bun run smoke` continue to pass.
- Core library tests run against the in-memory port and preserve round-trip, version/hash conflict, trash, schema rejection and path-safety behavior.
- Desktop adapter conformance runs in temporary directories; inject failures before commit and prove the old file remains intact.
- Browser adapter unit tests cover commit expectations, moves, device identity, permission mapping and archive import. `apps/web/check/` exercises OPFS, a stale-save conflict, archive round-trip, IndexedDB, picker cancellation, a denied folder permission that keeps the pending folder, two-tab lock serialization, and an OPFS page restart in a real browser. Quota exhaustion, the native folder picker and real Safari/Firefox still need the full matrix (T013/T027). No test uses the author's actual browser profile.
- Archive tests cover round-trip hashes and IDs, unknown files, credential exclusion, traversal, duplicate paths, symlink entries, corrupt hashes, future format/schema, entry/size caps and failure cleanup.
- Once spec 013 builds `apps/web`, run Playwright end-to-end in Chromium and WebKit/Firefox where the runner supports them. Run packaged Electron hidden smoke and iOS Simulator verification under spec 014.
- Manually inspect light/dark and reduced-transparency states at 393 × 852, 744 × 1133, 1024 × 700 and 1440 × 900.

## Out of Scope

- Provider endpoint/CORS work beyond the verified capability registry and spec 011.
- Hosted accounts, server-side file copies, API proxies, telemetry or remote backups.
- A primary browser database, new file format, sync/merge algorithm or cross-device account.
- Native iOS storage, protected credentials, lifecycle, permissions and capability/refusal integration belong to spec 014; native choices remain gated by D-117 and other applicable decisions. App Store distribution is outside this browser plan.
- Production hosting, release promotion and rollback, owned by spec 013.
