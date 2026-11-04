# Research: format-profile persistence and physical-layout controls (D-170)

**Task:** 035 T008 · **Status:** research recorded, decision not accepted — nothing is persisted here.
**Outcome (2026-11-04):** D-170 was accepted as recommended: settings persist per book, the target
stays a per-export choice, no profile persists and no physical control is modeled.
**Evidence:** `packages/core/tests/format-profile-premises.test.ts` (3 pass, in-memory library
port); `apps/desktop/tests/export-renderers-premises.test.ts` (page-geometry premise);
`packages/app/src/components/FormatDialog.tsx` (transient target state, canonical binding);
`packages/core/src/schema.ts` (loose book object, strict settings object). No live provider,
paid service or author manuscript was used.

## Current shape (observed)

- `settings.manuscript` is the single canonical typography source (FR-002): font, size, indent,
  line spacing, title alignment, table-of-contents flag, line-break preservation. The Format
  dialog binds it with full-settings-merge saves and creates no duplicate profile (T002/T003).
- The export target (`DOCX`, planned PDF/EPUB/Markdown) is transient component state defaulting
  to DOCX. Nothing target-specific persists — no profile field exists anywhere in the codebase.
- The book object is loose: unknown top-level fields survive supported saves, including across
  the FormatDialog's full-settings merge (premise tests). An additive top-level profile section
  needs no migration.
- The settings object is strict: unknown sections nested under `settings` are stripped by any
  supported save (premise test). Per-book profiles cannot nest under `settings` without a
  schema change — doing so would silently lose data.
- The DOCX pipeline passes empty section properties, so the `docx` library injects its own
  defaults: A4 (11906×16838 twips), 1-inch margins (premise test). Page geometry exists in the
  file but no author value reaches it. Physical-layout controls would override library defaults,
  not fill a blank — and PDF/EPUB renderers are unselected (D-108), so no target could honor
  them yet.

## Per-book vs per-export (proposal)

Persist per-book nothing target-specific until a selected renderer consumes it. Storing
overrides no renderer reads would create dead settings the UI implies are live. Until then:

- Per-export choices stay transient dialog state, always defaulting to the canonical
  `settings.manuscript` values. What the author picks for one export never leaks into the
  next except through the canonical settings they explicitly changed.
- When a renderer is selected and can honor a target-specific value differently, per-book
  profiles persist as an additive top-level `formatProfiles` section:
  `Record<Target, Partial<manuscript-like overrides>>`. Top-level because the settings object
  strips unknowns; the FormatDialog merge pattern is already compatible with it (premise test).
- The canonical `settings.manuscript` stays the fallback for every target and the only place
  shared typography is edited — profiles override per target, never replace the canonical
  source, so FR-002 survives profiling.

## Physical-layout controls (proposal)

Model none until the D-108 renderer acceptance and this decision are both accepted. Concretely:

- No trim-size, margin, page-size, gutter or bleed control is added now. There is no target to
  honor them, and the only geometry in the file is an invisible library default.
- When modeled: explicit units (inches), per-target (a 6×9-inch trim is meaningless to EPUB
  reflow), overriding documented defaults rather than implying the file had none. Never pixels,
  never unitless numbers, never a control that implies measurement before a renderer supports it.

## Alternatives considered

- Persist per-book profiles now (rejected): nothing reads them; they would be dead settings
  implying live behavior, and the settings-nesting variant silently loses data.
- Nest profiles under `settings.manuscript` or beside it (rejected): the settings object
  strips unknown sections on every save — proven data loss, not just a style preference.
- Add physical controls against the current DOCX pipeline (rejected): they would override
  library defaults the author cannot see, for targets that do not exist yet, with no
  conformance story (D-108 unresolved).

## Recommendation

Transient per-export choices defaulting to canonical manuscript; additive top-level
`formatProfiles` reserved for when a selected renderer consumes target-specific values; zero
physical-layout controls until D-108 acceptance. The target selector stays transient
throughout — persisting it would promise a configured target the studio does not have.

## What this unblocks when accepted

Nothing builds on it yet by design: T008 blocks only persistent target-specific settings and
physical-size controls. When renderers land, the implementation task can use the reserved
`formatProfiles` shape without a new format decision.
