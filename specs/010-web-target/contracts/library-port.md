# Contract: LibraryPort

**Spec**: [010-web-target](../spec.md) · **Plan**: [plan.md](../plan.md)

## Purpose

Expose the minimum target-neutral file operations needed by shared library rules. The Electron main process and browser runtime each construct an adapter; the renderer never receives a raw filesystem path or a general-purpose filesystem API.

## Type contract

```ts
export interface LibraryFileSnapshot {
  bytes: Uint8Array;
  sha256: string;
  createdAt: string | null;
  modifiedAt: string | null;
}

export type FileExpectation =
  | { kind: "absent" }
  | { kind: "sha256"; value: string }
  | { kind: "any" };

export type CommitFileResult =
  | { status: "written"; snapshot: LibraryFileSnapshot }
  | { status: "changed"; current: LibraryFileSnapshot | null };

export interface LibraryPort {
  readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null>;
  listDirectory(path: LibraryPath): Promise<LibraryEntry[]>;
  stat(path: LibraryPath): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null>;
  ensureDirectory(path: LibraryPath): Promise<void>;
  commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult>;
  moveFile(from: LibraryPath, to: LibraryPath): Promise<void>;
  removeFile(path: LibraryPath): Promise<void>;
  watch?(path: LibraryPath, changed: (path: LibraryPath) => void): () => void;
  deviceInfo(): Promise<{ id: string; name: string; createdAt: string }>;
}
```

Runtime primitives (`now`, `newId`, `sha256`) are injected separately as `LibraryRuntime`, so the
shared service imports neither `node:crypto` nor DOM APIs. The implemented contract is in
`packages/core/src/library/port.ts`.

The exact TypeScript aliases can vary during implementation, but the observable results and invariants below are normative.

## Invariants

1. `path` is a validated library-relative path; adapters reject traversal, absolute paths and special files.
2. `readFile` returns the complete bytes of one committed file or `null`. It never returns a partially written file.
3. `commitFile` makes a complete replacement visible only when it commits. If it fails, the prior complete file is unchanged. `any` is reserved for derived files such as `library.json`; manuscript writes use `sha256` or `absent`.
4. If `sha256` is supplied and the adapter observes a different current file, it returns `changed` without replacing it. Core then applies the normal conflict-copy policy.
5. Core compares base version and hash before every manuscript save even if an adapter has a writer lock or watcher. The port expectation closes the remaining race between that check and the commit.
6. The adapter does not decide which conflict copy to keep and does not delete text to make a write succeed.
7. Errors are typed and safe to expose; error values never include raw file content, credential bytes or absolute host paths.
8. `watch` is advisory. Lack of notifications never disables read/compare/save checks.
9. Electron's adapter uses `writeFileAtomic`; the browser adapter uses a complete writable stream and commits on close. Neither adapter reports saved before commit resolves.
10. The in-memory port runs the same conformance suite as production adapters; `packages/core/tests/library-service.test.ts` is that suite. `listDirectory` returns `[]` for a missing directory and skips symbolic links.

## Error cases

| Code | Meaning | Required recovery |
| --- | --- | --- |
| `permission-required` | Browser permission is missing/revoked | Ask the author to grant access again; do not switch tiers. |
| `read-only` | Destination cannot be written | Explain that the last committed file is unchanged; offer another destination. |
| `storage-full` | Storage quota or destination capacity is exhausted | Explain that the last committed file is unchanged; offer export/cleanup/retry. |
| `invalid-path` | A generated or archive path violates path rules | Reject before write and record a safe diagnostic. |
| `conflict` | Expected hash/version differs | Preserve the author's text through the shared conflict policy. |
| `unsupported` | Adapter lacks an operation/capability | Explain the unavailable operation; never fake success. |
