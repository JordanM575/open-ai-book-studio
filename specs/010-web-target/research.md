# Research: browser target

**Spec**: [spec.md](spec.md)

## Decisions and findings

### Real-folder access is capability-detected and user initiated

- `showDirectoryPicker()` is limited-availability, only works in secure contexts and requires transient user activation. Permission can be denied or revoked, so a saved handle is not equivalent to a permanent grant.
- The web app will test the capability at runtime rather than infer it from the browser name. Choosing the folder is initiated by an author action. If the picker is absent or permission is revoked, the UI explains the state and never silently changes storage tiers.
- Evidence: [MDN: `Window.showDirectoryPicker()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker), accessed 2026-10-24.

### Origin-private storage is not a user-visible backup

- OPFS is broadly available and supports file/directory operations without a folder permission prompt. Its content is private to the origin, is subject to browser quotas/eviction, and is deleted when site data is cleared; it is not presented as normal files in the user's file manager.
- `navigator.storage.persist()` is only a request. It resolves true or false and the browser decides whether to grant it. The interface will state the result, not promise permanence. A portable archive remains the recovery path.
- Evidence: [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [MDN: `StorageManager.persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), accessed 2026-10-24.

### Browser credentials need a stronger disclosure, not a false encryption claim

- IndexedDB is origin-scoped, but any script executing on that origin can access same-origin data. An application-managed non-extractable wrapping key does not protect against a compromised same-origin script that can ask the browser to use it.
- Existing spec 011 already selects origin storage with a visible disclosure. Passphrase encryption would create a recovery secret and friction without removing the same-origin execution risk. The accepted v1 choice is an origin-scoped IndexedDB vault with no passphrase and no claim that it is encrypted like an OS keychain.
- The web app must self-host its runtime and dependencies, avoid third-party scripts and analytics, keep keys out of URLs/library/archive/logs, and offer a one-action Forget control. On a shared or untrusted profile, the author should not connect a valuable key.
- Evidence: [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), accessed 2026-10-24; project constitution §3; spec 011 US7; D-105.

### Portable archives use an explicit, validated file manifest

- Whole-library migration must preserve ordinary file bytes and identities rather than round-trip files through UI/domain objects that can lose unknown metadata.
- The accepted format is a ZIP container with a versioned `manifest.json`, normalized library-relative paths, file lengths and SHA-256 hashes. Import rejects duplicate/absolute/traversal paths, unsupported format/schema versions, >10,000 entries, >2 GiB expanded total, a file >512 MiB, insufficient destination capacity, and hash mismatch before publication. Credentials, generated catalog/index, temporary/lock files and per-install device identity are excluded; other format-defined and unknown library files are preserved.
- Import is into a new library or an empty chosen destination, never a silent merge. Validation happens before writes; on write failure, only new staging/destination files may be cleaned up, and no pre-existing library is replaced.
- `fflate` provides streaming ZIP/Unzip APIs and supports bounded output chunks; use those rather than materializing an entire untrusted archive in memory. Application code still validates every path, declared and actual size, entry count and hash.
- Evidence: [fflate documentation](https://github.com/101arrowz/fflate), queried through Context7 2026-10-24; spec 002 FR-056/FR-076; D-112.

### Direct provider access remains gated

- A static browser application has no studio backend. Model requests must be made directly to a provider using an author-requested connection. The provider registry and D-101's browser-access result remain the single source of truth; current evidence verifies OpenRouter only.
- Unsupported browser provider flows are not proxied or enabled by guessing. OpenRouter's same-origin OAuth callback and PKCE are specified in D-104/spec 011; credential storage follows D-105.

### Repository implementation audit: the accepted port is not yet in code

- ADR 0009 describes a shared `LibraryPort` and `fs`, `fsa`, and `opfs` adapters. In the current checkout, `packages/core` contains schema/Markdown/IPC/provider files but no `LibraryPort`; `apps/desktop/src/main/library/store.ts` still imports `node:fs/promises`, `node:crypto` and path helpers and owns library behavior. There are no `apps/web` or browser storage adapters yet.
- Therefore the first implementation phase must extract the checked library invariants behind a port and prove them with an in-memory conformance adapter before adding browser adapters. ADR 0009's wording that this refactor is already working is corrected by this spec's plan and an explicit implementation-status note.

## Deferred questions

- D-107's future derived search-index engine remains open. Spec 010 does not add an index: search reads source files through the port, and any later index remains rebuildable/disposable.
- Native iOS file access, Keychain and iCloud container behavior remain in spec 014/D-117, not this browser-storage decision.

## References

- [MDN: File System Access API folder picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [MDN: OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN: persistent origin storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [MDN: IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Spec 002](../002-studio-v1/spec.md), FR-056 and FR-071…FR-076
- [Spec 011](../011-model-access/spec.md), browser clarifications and US7
- [ADR 0009](../../docs/adr/0009-multi-target-storage.md)
