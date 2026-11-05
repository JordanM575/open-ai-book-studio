# Plan: book-level cover design

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

Reuse 019's asset/provenance seam but do not attach covers to chapters. Define composition contracts
in `packages/core`, accessible preview/controls in `packages/app`, and persistence through the
existing platform Library/storage port. Exact modules and paths await U-041-01. No format change is
made by this draft. An accepted layout requires an ADR and docs/FORMAT.md before implementation.

Start with selected existing art and front-cover composition. Resolve U-041-02 before the renderer
and exporter choose formats/fonts or claim measurable geometry. Keep export generation separate
from target readiness: 035 owns the validation results and rule versions. A print wrap depends on
measured pagination/paper inputs, not a preview estimate. Existing exports must not require all new
cover workflows to ship.

Optional image generation stays behind U-041-03 and the existing provider service. Disclose only
selected outgoing inputs and truthful cost facts. Credentials never reach the renderer or library.

Verify isolated synthetic assets, source hashes, unknown-field round trips, version conflicts,
path/dimension rejection, font failures and interrupted publication. Measure output independently
using the tools chosen in U-041-02. Use mocked provider calls; live paid generation is separate
authorized evidence. Finish built-app keyboard/theme/reduced-motion/reduced-transparency checks
and integrated tests/typecheck/smoke.
