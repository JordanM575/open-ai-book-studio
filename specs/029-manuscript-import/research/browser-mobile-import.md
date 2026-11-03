# Browser/mobile manuscript import (Spec 029 T016)

Validation only. No product behavior changes: every non-desktop target keeps
refusing manuscript import, pinned by
`apps/web/tests/storage/manuscript-import-refusal.test.ts`. Enabling any
target below needs its own source-read and complete-publication conformance —
a T013-style hidden-journey gate per target — not an argument that the desktop
path already works.

## The contract a target must meet

Source selection and publication are separate capabilities, and a target must
prove both:

1. **Source read.** The author picks a file through a native or browser picker;
   main (or the browser runtime) reads the bytes, enforces the accepted
   extension and the 5 MiB ceiling with strict decoding, and returns a typed
   refusal on cancel, missing file, unsupported input or read failure. Host
   paths never reach the renderer. Desktop proves this in T008.
2. **Complete publication.** A complete book appears under a unique staging
   path and is published with one atomic move; every pre-publication failure
   leaves no visible partial book and cleans up staging. Desktop proves this
   in T003 (atomic rename) and T009 (fault injection).

## Web: File System Access folders — refused

Source read is possible (`showOpenFilePicker` exists where the API does), but
publication fails the contract: every web port is `DirectoryHandleLibraryPort`
(`apps/web/src/storage/fsa.ts:52` for folders, `apps/web/src/storage/opfs.ts:62`
for browser storage), and its `moveDirectory` is a recursive copy followed by
a delete (`apps/web/src/storage/directory-port.ts:119-120`). A crash, a lost
permission grant or a closed tab between the two halves leaves a duplicated or
half-removed tree — exactly the visible-partial outcome T009 forbids. T003
already records that web copy+delete does not qualify for atomic publication.
Until a web port offers an atomic publish primitive with fault-injection
evidence, the folder target stays refused.

## Web: browser storage (OPFS) — refused

Same port class and same copy+delete blocker as folders. Additionally, no
`<input type=file>` source-read path has been validated as an import source
(the archive picker in spec 010 is a separate whole-library flow into a new or
empty destination, not a single-manuscript import). Both halves unproven.

## iOS and Android — refused

The Capacitor shell serves the web build directly (`apps/mobile/capacitor.config.ts`
`webDir: ../web/dist`) and ships no TypeScript runtime of its own, so both
platforms inherit the web refusal above. No native picker, filesystem port or
atomic publish path has been specified or validated. Touch layouts (spec 014)
do not imply storage conformance.

## Verdict

`books:pickImportSource` and `books:importManuscript` in
`apps/web/src/runtime/browser-api.ts` return the honest refusal
(`invalid`, "Manuscript import is available in the desktop app.") on every
non-desktop target. Per-target enablement needs, in order: a validated source
read, an atomic (or equivalently failure-clean) publish primitive with
fault-injection tests, and a hidden-journey conformance run proving no partial
book and an unchanged library otherwise. FR-024 stays desktop-gated.
