# Continuation check-in presenter

`ContinuationCheckinPanel` presents the counted check-in inputs for one
checked continuation campaign (039 T018 seam 6c) over the seam 6b client in
`packages/app/src/lib/continuation-checkin.ts`. It mounts in the workspace
beside `SavedReviewsPanel` and `PlanningPanel`, the closest mounted
book-scoped read surfaces in the same scroll column.

Opening the panel reads nothing. The author enters a campaign identity and
presses Load check-in; only then does the panel call the injected reader
(the 6b client by default). A loaded payload is shown by
`ContinuationCheckinResults` exactly as the checked campaign record carries
it: campaign and book identity, revision, segment and stage tallies,
checkpoint receipt tallies, and report tallies. Scalar and byte tallies keep
their exact saved labels. Nothing is recounted here, and no live generation
is implied: the panel presents a stored record only.

Every typed refusal keeps its own plain state in the status region, and a
refusal never renders counted inputs, so a partly present campaign is never
shown as complete. With no active coordinator run — the state of this
build — the panel says so plainly and leaves the saved campaign unchanged;
it never invents check-in data. Changing the book, or editing the campaign
identity after a load, clears the shown payload before another load.
