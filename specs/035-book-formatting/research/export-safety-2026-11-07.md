# Existing-format export safety — W05, November 7, 2026

## Evidence before implementation

Checkout `1844285e2dbb83e131e691393ed7ec6c9b4c394c` includes public baseline
`55b55b8` and plan `e46ef95181e5efd74ecf36cfa88ee69d1c18dc99`.
The existing four focused export suites pass (93 tests). Dependencies were absent initially;
`bun install --frozen-lockfile` restored them without changing the lockfile.

- T016's claim that the header exports after a failed save is stale: `runExport` already rejects
  error/conflict and `docx-export-flush.test.tsx` proves the error case. It should require a positive
  saved result for every non-null status, like Format, rather than enumerate two failures.
- Format's `settingsOut` tracks pending typography writes but `runExport` never checks it. Rejected
  settings writes are swallowed locally. Matter `persist()` returns true when there is no pending
  edit even after an earlier conflict; a second export can therefore bypass that conflict.
- `collectDocxImages` ignores the image store's returned manifest warning, null image reads and WebP
  omissions. Thrown reads are logged only. All four IPC results are `string | null`; they cannot
  carry truthful, snapshot-specific warnings to the UI.
- The single-file exporters check only a lexical library prefix and size/mtime before staging.
  An external symlinked parent can point into the library, a same-size replacement can evade the
  check, and a destination can change during staging. `createAtomicWriter` already provides scoped
  operation injection, durable staged bytes and owned-temp cleanup, but intentionally suppresses
  unlink errors. Export can wrap that seam without changing the central writer.

## Scoped decision under delegated authority

Proceed with positive save gating, persistent local save-error state until a successful subsequent
edit, and disabled formatting controls while exporting. Reuse the existing atomic writer through
an export-only wrapper: canonical-parent validation, regular single-link destination validation,
content/identity recheck immediately before rename, and truthful leftover-temp-path errors.
Retain replacement consent and cancellation through the existing picker. Clone the supplied saved
snapshot before awaiting picker/render operations. Preserve damaged-chapter refusal before the picker.

Rejected: broad writer/Library changes (unnecessary shared ownership), relying on size/mtime alone,
swallowing cleanup errors, re-reading images in the renderer (different snapshot), encoding warnings
in a path string, or treating a published file with skipped images as an export failure.

Prepare an explicit image collection result and renderer support for `{ path, warnings } | null`;
the parent owns the minimal IPC/core result extension and handler wiring. Keep string results
compatible during integration. Markdown remains a text-only single file and must disclose omitted
attachments; it does not silently acquire folder packaging. No D-108/D-169/D-170 policy is changed.

## API research and limits

Context7 lookup for Node.js failed with `Monthly quota exceeded`; consulted official
<https://nodejs.org/api/fs.html> instead (November 7). FileHandle write/sync/close must be awaited;
`realpath` resolves aliases; `lstat` identifies symbolic links; rename replaces atomically but is
not a compare-and-swap. This slice improves the prepublication recheck, not an adversarial-process
CAS guarantee or power-loss guarantee. Noncooperating external changes in the final check/rename
interval remain a platform limitation. Active export cancellation needs a separate IPC lifecycle
seam; this slice retains picker/replace cancellation only.

## Verification plan

Use synthetic temporary books only. Add regression cases for deferred/rejected typography saves,
previous matter conflict, every returned unsaved chapter state, missing/changed/unsupported images,
symlink aliases, changed destination bytes during staging, write/rename/cleanup failures and captured
snapshot output. Assert actual source/prior-output bytes and the reported leftover path. Run focused
export, matter and no-matter identity tests plus typecheck. Parent owns integrated/hidden checks.

## Candidate observations after implementation

The initial new regressions failed in six cases on unchanged production code: all four actual
exporters wrote through a parent alias into the synthetic library, the second export bypassed a
matter conflict, and export proceeded while typography was still saving. Those cases now pass.
The independent W15 audit's F1/F3 and W05 facts were read and corroborate this scope; the parent
owns the stale T016 sentence correction.

`export-publication.ts` wraps, but does not modify, `createAtomicWriter`. A destination fingerprint
includes the resolved parent, device/inode, size/times and SHA-256. Only ENOENT means an absent
destination. Symlink or multiply-linked destination files are refused. Benign outside parent
aliases are supported. The writer uses the checked canonical parent for staging/cleanup and
revalidates the originally chosen destination before each rename attempt. A retargeted alias
therefore cannot hide a temporary file from cleanup. Errors retain the original failure as `cause`
and include the actual leftover pathname when unlink fails. This remains a preflight/recheck,
not an OS compare-and-swap against a hostile process moving canonical path components after it.

Image collection distinguishes intentionally unused unattached assets from missing, unreadable,
unsupported and excess attached images. Markdown explicitly reports that its single-file output
does not include attachments. The new collection helper returns images and warnings together;
the old helper remains compatible and logs warnings until the parent changes the handlers.
Format and both header actions render the proposed `{ path, warnings }` receipt, accepting legacy
strings during integration. A receipt fixture is component evidence, not proof that today's
unmodified IPC handlers deliver warnings. The pending seam is specified in the W05 handoff.

Supplied `BookDetail` and image bytes are copied before awaits. This establishes immutable render
input, not an atomic multi-file Library capture; book metadata, chapters and images still come
from existing Library reads. Publisher conformance, exact pagination, folder packaging, native
renderer execution and active-operation cancellation are not established by this slice.
