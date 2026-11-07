# Plan: book-level cover design

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

**Status:** Draft / Planned. Expanded November 7, 2026; composition storage and output choices remain open.

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

## Decision work before implementation

| Question / task | Required decision packet | Evidence to distinguish alternatives |
| --- | --- | --- |
| U-041-01 / T001–T003 | Book-level composition identity, source references, layout/versioning, retention and conflict recovery | Existing 019 asset lifecycle and D-190 book-save behavior; compare a book extension and a sidecar without assuming either. Synthetic unknown-field, missing-asset, stale-write, archive/trash and failed-save cases. |
| U-041-02 / T004–T005 | Initial front-cover output, later wrap output, fonts/embedding rights, units/color assumptions and independent measurement tools | A fixture with known dimensions/text plus unsupported fonts, corrupt art and missing print inputs. Record target/rule version and what the chosen exporter can actually measure. |
| U-041-03 / T006 | Optional generation/edit capabilities, exact outgoing asset/prompt disclosure and provenance | Mock payload equality, pre-send cancellation, refusal, unknown cost and failed asset publication. Existing chapter generation is not cover composition or permission for automatic retries. |

## Delivery checkpoints

1. **Existing-art front cover (T001–T004):** after storage/output decisions, select an existing source
   asset and title/author text, save a checked book-level composition and preview it with an explicit
   approximation label. Keep chapter attachments and the original asset byte-identical. A preview
   alone cannot close persistence, conflict or export tasks.
2. **Snapshot export (T005):** capture the saved composition and source hashes, validate paths and
   dimensions, render to a failure-safe destination and measure the result independently. Font/art
   errors, cancellation, disk-full and interrupted publication must leave the prior destination and
   original composition usable. Report export success separately from target readiness.
3. **Measured print wrap (T005, later slice):** take accepted page-count, paper/binding, trim, bleed
   and safe-area inputs from 035's measured-output contract. Missing values remain unknown/not ready.
   Review the dimension formula and rule version before adding spine/back-cover claims; approximate
   manuscript previews cannot supply a measured page count.
4. **Optional generated art (T006):** only after U-041-03, use the existing privileged provider seam
   with a provider-named start and the disclosed inputs. Preserve successful source art when a later
   save fails and never substitute another provider or regenerate automatically.
5. **Acceptance (T007):** verify keyboard/theme/reduced-motion/transparency and host refusal against
   the built slice. Attach source/output hashes, measurement results and exact-head checks; no
   publisher acceptance follows merely from producing a valid image.

## Verification

Verify isolated synthetic assets, source hashes, unknown-field round trips, version conflicts,
path/dimension rejection, font failures and interrupted publication. Measure output independently
using the tools chosen in U-041-02. Use mocked provider calls; live paid generation is separate
authorized evidence. Finish built-app keyboard/theme/reduced-motion/reduced-transparency checks
and integrated tests/typecheck/smoke.
