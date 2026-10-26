# ADR 0012: Portable library archives preserve source files

- **Status**: Accepted
- **Date**: 2026-10-24
- **Related**: D-112; spec 002 FR-056/FR-076; spec 010; ADR 0002, 0009

## Context

The browser's origin storage is not a user-visible folder. Authors need a reliable way to move a library to desktop or another browser profile without losing IDs, unknown metadata, conflicts, trash or future format-defined files. D-112 proposed a ZIP archive with a manifest but had not selected import failure behavior or version policy.

## Decision

- Use a ZIP archive with a versioned `manifest.json`, normalized library-relative file names, declared sizes and a SHA-256 hash for each file. The manifest records archive format version, application version and library schema versions.
- Include all format-defined author files (including conflicts, trash and future thread/checkpoint files) and preserve unknown files. Exclude the rebuildable `library.json`, per-install `.studio/device.json`, transient locks/temporary files and every credential or app-profile secret.
- Import into a new browser library or an empty author-chosen folder. Do not merge or overwrite an existing library. Preserve book/chapter IDs and source-file bytes.
- Validate the complete manifest and archive before publication. Reject unsupported future archive/schema versions, duplicate or unsafe paths, symlinks, hash mismatches, more than 10,000 entries, more than 2 GiB expanded data, any single file over 512 MiB, or insufficient destination capacity. Do not write a rejected archive into a live library.
- If a write fails after staging begins, leave all pre-existing libraries untouched, remove new staging files where possible, and tell the author what remains if cleanup is incomplete.
- Use streaming ZIP APIs from `fflate`; do not load an untrusted whole archive into memory before validating its declared and actual sizes.

## Consequences

- Desktop export/import gains an explicit file-picker workflow; browser import/export is available in both real-folder and origin-storage tiers.
- The ZIP is a transport format, not a second book format. Ordinary library files remain the source of truth.
- Excluding per-install device identity means an imported library receives a new device identity while its books and chapters keep their IDs.
- Unknown files are preserved but never executed or interpreted by the importer.

## Rejected alternatives

- **One JSON blob per book/library** — duplicates the format, loses ordinary-file editing and makes unknown fields harder to preserve.
- **Merge on import** — creates ambiguous ID collisions and silent overwrite/conflict behavior; a separate destination is safer and testable.
- **Export only books/chapter Markdown** — would omit author-owned conflicts, trash, images and future library data.
