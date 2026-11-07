# Chapter history leaf UI

## Bounded implementation decision (2026-11-07)

Under the delegated W02 UI assignment, implement spec 032 T006 as an injected-callback dialog,
using D-175/D-176 and ADR 0016's already accepted saved-only operations. The parent owns mounting,
navigation, validated IPC and authoritative draft gates. A renderer-owned writer or guessed global
API would bypass that ownership and is rejected. No new persistence policy is selected here.

Use the shared Dialog's focus trap/return behavior, native buttons for keyboard selection, tokenized
surfaces and literal preformatted text. Compare full bodies with a marked changed span from first
through last difference, rather than a quadratic line-diff matrix or rendered Markdown (which could
hide source text or load remote images). This is a bounded linear comparison presentation, not a
minimal edit script. All source text remains present and copyable.

React's current `useEffect` documentation (https://react.dev/reference/react/useEffect, read
2026-11-07 after Context7 returned quota exceeded) documents cleanup-based stale response exclusion.
Apply that to each dialog lifetime and request; use committed source revisions to reject ABA source
responses. A capture receipt is a persistent outcome, so a changed source must not turn an already
kept snapshot into a cancellation. The focused synthetic tests exercise these boundaries.

## Parent contract

`ChapterHistoryDialog` takes `open`, `target`, `chapterTitle`, `state`, `api` and `onClose`.
The exported interfaces live in `types.ts`. The target contains real `libraryId`, `bookId`,
`chapterId`, and a unique `viewId` for each host navigation lifetime, including return to the same
chapter. Library identity must change when its backing storage instance changes. Do not derive
these values from titles or invent a fallback identity. Closing unmounts the session; target changes
reset it. The host must commit navigation/state changes promptly, including when a view is hidden.

`state.saved` is the current confirmed `{ version, hash }`, or null. `dirty`, `pending`, `conflict`
and `failed` describe the real editor/save state. Update them synchronously with host changes.
Increment `state.revision` for every saved/draft/save-state transition, including intermediate
transitions batched into one React commit. This makes A → B → A observable even when the final
version/hash and flags equal the earlier values; never reset that generation within a view lifetime.
Capture requires a saved token and all four flags false. The API receives the originating target
plus the exact W01 input, with no draft/body. Each callback must bind to that library/view lifetime,
validate its scope, and reject obsolete dispatches. Desktop must use validated IPC/preload and the
existing sole Library writer; browser hosts must use their current shared runtime.

Recheck the real draft/save gate at the authoritative capture boundary, before dispatch/publication;
the renderer's disabled button is not proof of host state. List/read/compare must never call save,
draft flush, export preparation, or change the editor selection/content. Unwrap Result envelopes in
the adapter; resolve only validated W01 outputs and reject with safe author-facing errors.

Capture callbacks must resolve only a confirmed kept record. They must preserve uncertain outcomes,
never retry automatically, and keep any host-level outcome notification attributed to its original
target after this dialog closes. Closing does not cancel an already dispatched capture. Reopening
lists storage afresh; delayed old receipts/errors cannot update the new session. A failed capture
requires an explicit successful Refresh history started after that failure before another attempt.
The recovery epoch must still match at completion; an earlier pending refresh cannot release a new
uncertainty gate. Failed refreshes never release it. Close is latched synchronously for the lifetime,
including re-entrant events or a throwing host notification, and cannot revive a late capture.

## Later extension seam

The parent may later add a separately reviewed restore/undo confirmation journey using W02 core
preflight, safety snapshot, prepared intent, exact result and reconciliation contracts. It can use
the selected record's filename/ID/raw hash and the displayed saved token as preview context only,
not as authorization or a historical restore base. The authoritative operation must re-read the
current source and enforce real draft gates. This leaf currently exposes no restore/undo/delete
action or callback. Intent records are inspectable status metadata, with no body comparison.

Parent mount/navigation integration, real-host gate tests, hidden app and browser journeys,
light/dark/reduced-transparency visual acceptance and full application gates remain outstanding.
