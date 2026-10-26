# Contract: Portable library archive v1

**Spec**: [010-web-target](../spec.md) · **Plan**: [plan.md](../plan.md)

## Container

- ZIP container, UTF-8 names, no encrypted entries, no symlinks or special files.
- One root `manifest.json` with format version 1, app version, creation time, entry count, expanded byte count, and per-file path, byte length and SHA-256. The manifest is capped at 16 MiB so a forged header cannot exhaust memory; 10,000 entries still fit.
- Every entry path is relative to the library root and uses normalized `/` separators.

## Export

- Include all author-owned library files, including unknown files, conflicts, trash and any format-defined planning, conversation, checkpoint or image data.
- Exclude `library.json`, every `.studio/` file except `.studio/trash/` (identity, indexes, credentials and browser handles live there), temporary files, locks and generated staging files.
- Read each file through `LibraryPort`; record exact uncompressed byte length and hash. Do not parse and reserialize manuscript files.
- Stream ZIP output and display progress only for work actually completed. A failed export leaves any previous destination archive intact.

## Import

1. First pass: read only `manifest.json` and each entry header. Validate the manifest, normalized paths, duplicates, traversal, absolute/drive paths, NUL, entry count and declared sizes. No destination byte is written until this pass succeeds.
2. Enforce 10,000 entries, 2 GiB expanded total, 512 MiB per entry, a 16 MiB manifest, and available destination quota/capacity. Check declared limits before extraction and actual byte counts during the second pass.
3. Verify every hash and the supported archive/schema versions. Preserve unknown file bytes; never execute or parse unknown content as code.
4. Import only to a new browser library slot or an empty chosen destination. Refuse a non-empty destination; no merge/replace mode in v1.
5. Second pass: verify each file's SHA-256 and commit it with an `absent` expectation. If a write fails, remove the files this import wrote; existing files are never removed or replaced. The destination must be new or empty.
6. Generate new per-install device identity; preserve book and chapter identities and all included source file bytes.

## Forward compatibility

An archive with a future format or book schema version is rejected with an update-app message. It is not partially imported or downgraded. A future importer must add explicit migration support before accepting that version.
