# Planning UI leaves

These components implement manual planning and the bounded goal portion of ADR 0017 / specs 030 and 033.
`PlanningPanel` mounts them in the shared workspace, using the existing Library's checked services
through `library/planning-api.ts`. They add no provider call or automatic save.

- `WorldbuildingDialog`: `recordId` omitted creates a world detail; supplied edits the exact saved
  record. Fields stay literal. The host assigns IDs, validates full serialized size, and owns all
  file/record revision and conflict-copy rules.
- `ManualPlanningDialog`: timeline create/edit (including literal `when` labels), beat create/edit,
  optional story-notes set/edit/clear, explicit timeline/beat order, and reversible archive/restore
  for all three list kinds. These controls are mounted in `PlanningPanel`. Order includes archived
  records and never changes chapter order. Archive requires a native confirmation checkbox followed
  by Save changes. Clear notes blanks only the three known text fields, retaining the singleton's
  identity and unknown data; clearing absent notes is a no-write operation.
- Checked creation results bind the open editor to the newly assigned identity. Continuing to edit
  after creation edits that record rather than creating a duplicate. Only a checked result can make
  that transition; Reload after an uncertain creation never guesses an identity or replays the draft.
- `GoalDialog`: an optional positive safe-integer total-book goal. Clear only changes the local
  draft; Save changes submits null. It includes `SavedGoalProgress`.
- `SavedGoalProgress`: accepts only an injected `GoalProgress` reader, never BookSummary, cached
  editor counts or draft text. Incomplete/unavailable states have no total or percentage.

## Callbacks and scope

Dialogs take `open`, `bookId`, `bookTitle`, `viewGeneration`, `read`, `save`, `onClose`, optional
`onResult` and `onSessionState`. Goal controls also take `readProgress`, `sourceGeneration` and
`manuscriptState` (`clean | dirty | pending | failed | conflict`). The standalone progress component
accepts `unconfirmedGoal` when a surrounding goal draft is dirty/pending/failed/conflicting.

`read(bookId)` returns the core `SidecarRead<T>`; `save(request)` accepts the exact core
`PlanningSaveRequest` / `GoalSaveRequest` and returns `SidecarSave<T>` or `{status: "refused",
message: string}`. Only return refused for a known failure before publication. Preserve thrown
`outcome: "not-kept"` for failed recovery. All other throws are conservatively uncertain; do not
map a generic failed IPC Result to an assumed non-write. No `instanceof` check across IPC is needed.

`onResult(view, result)` reports only checked saved/unchanged/conflict results. It never closes the
dialog automatically. `onClose(view)` is the close authorization after the UI's discard decision.
`onSessionState(view, {dirty, pending, needsReload, requestClose})` lets the host route book changes,
library changes and external close actions through the same guard. The host must retain the mounted
session until close authorization, and block navigation while pending. A forced unmount cannot keep
an in-memory draft or cancel an already-sent operation.

These observer/close callbacks are synchronous. Their thrown exceptions are contained and visibly
reported separately from checked write outcomes: a state-observer failure retains the draft, a
failed close restores the editable session, and a result-observer failure cannot relabel a known
save or trigger a retry. Host navigation must start blocked and remain blocked if guard registration
fails. Keep editing returns focus after the form is enabled in the committed DOM.

Advance `viewGeneration` for every view/library lifetime, including A → B → A and a new session for
the same book. The components also invalidate old operations on unmount. Reads, writes and result
notifications are pinned to initiating callbacks; replacing props in a live session never rebases
the draft or redirects a callback. To replace the service/library, first resolve the old session and
open a new generation.

Advance `sourceGeneration` when saved chapters, their readable completeness, or the saved goal
change. This immediately discards the previous progress display and checks the new saved source.
Do not increment it just for unsaved typing: change `manuscriptState` so the prior complete count is
labelled “Last confirmed saved”. Incomplete/unavailable checks remove any prior complete count.

## Recovery and integration boundaries

Conflict/uncertain outcomes retain the original baseline and pause further submission. Review saved
version is read-only comparison and never rebases. Reload and discard draft is an explicit separate
confirmation, and a failed reload keeps the draft. Later edits after a conflict are not falsely
described as part of the already-kept copy. `onResult` supplies the copy path for central discovery.

The integrated host supplies validated desktop/browser bindings, fresh completeness-aware saved
reads, `PlanningCopies` inspection and `PlanningNavigation` guards. A session starts blocked before
mounting, and only matching leaf registration installs its close action. Shell library selection holds
the guard across its await; book/conversation/drift navigation and native beforeunload first resolve
the editor. A blocked navigation is not queued: after closing, retry that action. Unsupported hosts
have no `planning` capability and cannot open a draft.

Recovery is manual and checked: inspect the complete verified read-only copy, reopen the current
goal/planning editor and enter the chosen fields before Save changes. Copy metadata is never an active
baseline. Copies remain in ordinary files even if inspection fails. There is no whole-document
replacement. These journeys do not deliver full
specs 030/033; fresh independent review and parent integrated gates remain required.

Focused synthetic tests: `apps/desktop/tests/manual-planning.test.tsx` (mounted planning controls,
real filesystem Library/handler, ordering, archive/restore and draft/lifetime guards),
`packages/core/tests/planning/manual-planning.test.ts` (all intents and exact response validation),
`apps/desktop/tests/planning-dialogs.test.tsx` (including the actual mounted
Workspace/registered IPC/filesystem), `planning-storage.test.ts`, core planning integration and browser
adapter planning tests. Design uses the existing
shared Dialog/Button, native labelled controls, token surfaces and 44px minimum local controls.
Integrated theme/viewport/keyboard smoke and application acceptance remain host-owned.
