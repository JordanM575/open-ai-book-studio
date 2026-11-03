# Format journey design (Spec 035 T001)

Accepted design for Phase 1. Entry point, target selector, unsupported-target
states, accessible labels, and the persistent Approximate preview disclosure.
Typography edits bind `settings.manuscript` as the single canonical source
(FR-002); no duplicate profile is created. PDF, EPUB and Markdown stay
visibly unavailable (FR-003); the current DOCX export button is unchanged.

## Entry

A ghost icon button beside Export in the workspace toolbar (and the same
action in the overflow menu): `Format book`, `data-testid="format-book"`.
It opens the Format dialog for the open book. No keyboard shortcut; the
button is reachable by Tab in toolbar order.

## Dialog sections (top to bottom)

1. **Target.** A native radio group, one input per target, keyboard free:
   - DOCX — available, checked by default. Note: "Exports from the existing
     Export button. This dialog previews only."
   - PDF, EPUB, Markdown — `disabled`, each followed by a Planned note.
     Disabled inputs can never be chosen, so no target can appear to export
     successfully. Target choice stays local dialog state; nothing persists
     it (no per-export profile until T008 decides).
2. **Typography.** Native selects and checkboxes bound to
   `settings.manuscript`, sentence-case labels, always in this order:
   Font, Size, First-line indent, Line spacing, Chapter titles
   (Left/Center radios), Table of contents (checkbox), Keep line breaks
   (checkbox). Every change persists immediately through `books:update`
   with a full-settings merge (current settings plus the changed manuscript
   field, so agent/cache sections are never dropped). A failed write calls
   the workspace notice and reverts the control to the last saved value;
   the preview follows the last saved value too.
3. **Approximate preview.** An article rendering the saved chapters in
   order — chapter titles plus body paragraphs — styled from the current
   settings (font family, point size, indent, spacing multiplier, title
   alignment, line-break handling, optional contents list). Above the
   article, a disclosure block that is always rendered, never dismissible,
   and does not depend on hover or color alone:
   "Approximate preview. Final output may differ in your word processor.
   Nothing here measures pages, breaks, counts or trim."

## States

- **Idle:** the dialog as described; preview reflects saved chapters and
  the last saved settings.
- **Saving:** transient per-control (the control keeps its value while the
  write is in flight; a second change supersedes, last write wins per
  control — settings writes are whole-object and idempotent).
- **Error:** write failure surfaces through the workspace notice; controls
  and preview revert to the last saved settings. The disclosure stays
  visible in every state.
- **Cancel/close:** the dialog close control and Escape; no export action
  lives in this dialog, so closing never starts, cancels or reports an
  export.

## Content source and honesty rules

- The preview renders **saved** chapter text from the open book detail. It
  never reads the live editor draft and never writes chapters, settings
  aside. Autosave keeps drift brief; no "unsaved changes" badge is shown
  (out of scope for Phase 1).
- No provider request is made for any preview, control or state. The dialog
  works fully offline.
- The Table of contents preview is a plain chapter-title list, not links;
  it claims no pagination. Include-table-of-contents state still only
  affects the DOCX builder as today until D-108 decides renderers.

## Accessibility (with ui-ux-pro-max preflight)

- Native radio/select/checkbox inputs with associated labels; no custom
  dropdowns or pointer-only targets.
- Disclosure is text, always in the layout flow, never hover/title-only
  and never color-only.
- Dialog focus trap and Escape come from the existing Dialog primitive;
  section headings give screen-reader structure.
- Design tokens only; the preview article inherits manuscript surface
  styling. No new motion; reduced-motion/transparency preferences already
  honored by `base.css`.
