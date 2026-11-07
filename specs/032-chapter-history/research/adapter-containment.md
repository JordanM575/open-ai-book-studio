# Desktop adapter containment (W01 review F3)

## Decision — accepted under delegated repair authority, 2026-11-07

Apply the desktop adapter's existing no-symbolic-links/no-special-files policy to
direct operations as well as directory enumeration. This repairs the shared
adapter; it does not implement chapter history or change the library format.

Evidence at base `c418b2fc9d14a87e10175da6264ca31565016f64`: a synthetic
`books/book_synthetic/history` link to a sibling fixture directory let the actual
adapter return `written` for `history/ch_synthetic/2026-snapshot.md`. The bytes
appeared outside the library and the actual archive manifest omitted the record.
There was no concurrent writer. W01 review F3 reports the same defect through the
history service, which is not in this repair checkout.

The existing port invariant rejects special files; archive v1 excludes links and
special files; `listDirectory` already skips both. Therefore accepting links whose
targets happen to be inside the root would still be inconsistent: a history link
to `.studio/` would publish successful but unarchived author data. Lexical
`safeJoin` alone cannot enforce this policy.

## Selected policy and implementation plan

- The deliberately selected root is the trust boundary. Its own spelling and
  ancestor aliases remain supported, including macOS `/var` → `/private/var` and
  a selected folder symlink. Do not canonicalize the root or change the path keys
  used by existing own-write bookkeeping.
- Validate library-relative segments at the adapter boundary. Inspect each
  existing component **below** the selected root with `lstat`, including the leaf.
  Reject links (inside, outside, broken or cyclic) and special files as
  `LibraryPortError("unsupported")`, without opening their targets. Intermediate
  regular files are errors, not absent directories. Only `ENOENT` permits a
  missing suffix; permissions and other errors propagate.
- Apply this check to reads, metadata, listing, mkdir, both move endpoints,
  removals, device metadata and watch registration/events. Preserve missing-path
  read/list results and normal atomic-write/expectation behavior.
- Device metadata may still regenerate after malformed JSON or incomplete
  identity, but a failed filesystem read must not trigger replacement. Keep its
  existing location and identity semantics.
- Whole-tree rename/removal does not dereference links within that tree. Keep
  those operations supported; links travel as links on rename and are unlinked
  during explicit tree cleanup, never traversed for content. Post-move own-write
  enumeration must use guarded adapter reads and continue skipping links and
  special files. Preserve best-effort bookkeeping after a completed move.
- Watch notifications remain advisory. Validate the watched path synchronously
  because registration returns a stop callback synchronously. Validate event
  paths before dispatch; skip unsupported/unreadable events, but continue
  delivering missing paths for deletion handling. No polling or new watch model.

Rejected alternatives: following resolved in-root links (archive mismatch),
rejecting symlinks above the selected root (breaks ordinary platform aliases),
history-only checks (leave other port operations unsafe), and a native descriptor
or OS-lock redesign (outside this bounded shared-adapter repair).

## Limits and validation

Checks are pathname preflights, not a sandbox or OS-level compare-and-swap. A
hostile concurrent replacement after a check can still redirect a later syscall;
watch delivery and post-move bookkeeping have the same limitation. Root identity
is not pinned. Hard links, mount points, filesystem-specific aliases not reported
by `lstat` as symbolic links, cross-process writer isolation and power-loss
durability are not newly guaranteed. Atomic writer temp-name and cleanup limits
remain as documented in `atomic.ts`. No new cross-device publication guarantee.

Focused synthetic tests will cover normal/absent paths, root aliases, every direct
operation at descendant directory/file links, inside/outside/broken targets,
unchanged outside bytes and directory sets, rejected source/destination aliases,
error-vs-absence behavior, device metadata, watch filtering/deletions, own-write
bookkeeping and ordinary history-shaped archive inclusion. Parent must rerun the
actual capture/list/read/compare and archive/trash regressions after history
integration; this checkout cannot claim that service-level evidence.

API reference checked 2026-11-07: Context7 Node.js resolution returned `Monthly
quota exceeded`; official <https://nodejs.org/docs/latest/api/fs.html> was read
instead. `lstat` inspects the symbolic link itself whereas `stat` follows it;
`unlink` removes the link without affecting its target; recursive watch behavior
is platform-dependent. No new API or dependency is required.

## Implemented evidence

`apps/desktop/src/main/library/fs-port.ts` now applies that policy. The only
implementation file changed is the adapter: its private post-move enumeration
uses guarded port reads, and its synchronous watch path uses the same entry-type
predicate as asynchronous operations. `atomic.ts`, path helpers and own-write
state management needed no edits. Device JSON recovery catches parsing/shape
problems only; storage errors escape before regeneration.

On macOS arm64 with Bun 1.4.4, the focused containment file passed **28 tests,
274 assertions**. Including the existing library, staged-publication, own-write,
watch and atomic-write/fault files passed **86 tests, 467 assertions, zero
failures**. The real permission and FIFO cases and actual `/var` alias case ran
(no skips). Tests use temporary synthetic folders only. The three root-alias
cases consume real archive streams and inspect exact manifest hashes; all
rejected-link cases compare the entire synthetic tree without following links,
including outside bytes and directories.

Focused strict TypeScript checking of the new test and its import closure passed:

```sh
bunx --no-install tsc --noEmit --incremental false \
  --moduleResolution Bundler --module ESNext --target ES2022 \
  --strict --skipLibCheck --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --typeRoots apps/desktop/node_modules/@types,node_modules/@types --types bun,node \
  apps/desktop/tests/fs-port-containment.test.ts
```

Focused Biome lint of the adapter and containment test passed without diagnostics.
No full verify, coverage, build, e2e, native-device or real-provider checks were
run. Parent owns those gates and the post-history-integration regression above.
