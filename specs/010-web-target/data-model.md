# Data model: browser storage and portability

**Spec**: [spec.md](spec.md)

## Source library

The library remains the ordinary directory tree defined in [`docs/FORMAT.md`](../../docs/FORMAT.md). The browser adapter must not make a database record the only copy of a book, chapter, image, conflict, trash entry or future format-defined author file.

## Library-relative path

A `LibraryPath` is a normalized sequence of path segments relative to the library root. It is never an absolute operating-system path and never originates unvalidated from renderer input.

- Use `/` as the serialized separator in archives.
- Reject empty interior segments, `.`, `..`, NUL, absolute/drive paths, duplicate normalized paths and paths outside the known library root.
- Preserve filename case and bytes; do not apply Unicode normalization or slug rewriting.
- Adapters reject symbolic links and special files when enumerating/importing.

## LibraryPort

| Operation | Input | Result / invariant |
| --- | --- | --- |
| `read(path)` | library-relative path | Complete bytes and metadata, or not-found. No partial read is presented as a file. |
| `list(path)` | library-relative directory | Entries with name and file/directory kind. No arbitrary filesystem path escapes the adapter. |
| `stat(path)` | library-relative path | Size, creation and modification metadata, or not-found. |
| `ensureDirectory(path)` | library-relative directory | Create it and missing parents; an existing directory is not an error. |
| `commitFile(path, bytes, expected)` | normalized path, complete replacement bytes, and `absent`, `sha256` or `any` expectation | Commit only after a complete write. Failure leaves the previous file intact. A mismatched expectation returns the observed current bytes without replacing them. |
| `removeFile(path)` | existing library-relative path | Used only by explicit trash/restore policy; permanent deletion is not an ordinary chapter operation. |
| `moveFile(source, destination)` | two normalized library-relative paths | Used for trash/restore and staging. Refuses an existing destination; reports unsupported rather than silently copying incomplete data. |
| `watch(path, callback)` | path or library root | Optional external-change signal. A missing watcher never disables version/hash checks. |
| `deviceInfo()` | none | Per-install device identity, never a trusted path. Import regenerates this identity. |
| `now()`, `newId()`, `sha256(bytes)` | none / prefix / bytes | Runtime primitives injected so core imports neither Node nor DOM APIs. |

All operations return typed errors (`permission-required`, `read-only`, `storage-full`, `not-found`, `invalid-path`, `conflict`, `unsupported`) and do not log manuscript bytes or credentials.

## StorageSummary

The UI receives a summary, never a browser handle or filesystem path:

- `tier`: `folder` or `browser`.
- `label`: author-readable destination name (for example, a folder name or “This browser”).
- `permission`: `granted`, `needs-action`, `read-only` or `unavailable`.
- `persistence`: `granted`, `not-granted` or `not-supported` for origin storage.
- `lastCommittedAt`: nullable timestamp for the last confirmed write.
- `warning`: concise author-facing explanation for weaker guarantees or a blocked capability.

## Portable archive manifest v1

`manifest.json` has `formatVersion: 1`, `appVersion`, `createdAt`, `entryCount`, `expandedBytes`, and an `entries` array. Each entry is `{ path, size, sha256 }`, where `path` is a normalized library-relative path and `sha256` is lowercase hexadecimal SHA-256 over the exact uncompressed bytes.

- Preserve all author-owned files, including unknown files, conflicts, trash and any format-defined conversation/checkpoint/image data.
- Exclude `library.json`, `.studio/device.json`, temporary or lock files, browser handle metadata, and credentials.
- Limits: 10,000 entries, 2 GiB total expanded bytes, 512 MiB per entry, plus the destination's currently available capacity. Exceeding any limit fails before publication.
- The archive is transport only. On import, validate every path and hash and validate known book/chapter schema versions; never execute or interpret unknown file contents.
- Import creates a separate library at a new browser library slot or in an empty chosen folder. It does not merge into an existing library.
