# Design rules

The interface is built from the AI Book Studio design kit (Liquid Glass v20). `design/tokens.json` is
a vendored copy of its tokens; `bun run tokens` compiles
`packages/ui/src/styles/tokens.generated.css`. Do not hand-edit generated CSS, and do not invent a
colour, radius or shadow that is not in the tokens.

## Character

Calm, quiet, Apple-grade. The manuscript is the only solid surface on screen; everything that floats
above the window is glass. No orange, no brown, no gradient other than the ambient window wash.

**Positioning:** the agent works on the actual book, and the author keeps the actual files. The
category’s editing tools sell feedback, the hosted AI tools sell generation, and the planning tools sell
world-building; this product sells **ownership plus agency plus interop**. Lead with the folder, the
save status, the tool call and the finished file, not with an AI gradient. The full competitor review is
in [`research/branding-2026-10-26.md`](research/branding-2026-10-26.md).

Three layers, in order:

1. **Ambient** — `.window-wash`: six radial glows over `--ambient-base`, fixed attachment.
2. **Content** — the manuscript sheet (`--manuscript-bg`, `--elevation-2`), solid by design.
3. **Navigation** — header, chapter rail, chat panel, dialogs, menus: `.glass` or `.glass-strong`,
   with `--elevation-glass`. Nested glass does not blur again.

## Colour

Neutral surfaces plus one blue accent (`--primary`, #0071e3 / #0a84ff). Blue appears only on: the
single primary action per view, author bubbles, links, focus rings, selection. Agent bubbles use
`--secondary`. Hover uses `--accent` (6% black / 9% white).

- Status never relies on colour alone; warnings are a dot or ring plus a word.
- Status text uses `--destructive-text`, `--success-text` — never raw `--destructive` for type.
- On glass, use `--glass-secondary-fg` and `--glass-accent-fg`; the `.glass` class rebinds
  `--muted-foreground` for you.
- Charts use `chart-1…5`. Review marks (pacing, repetition, filler, passive, dialogue, variety,
  telling, voice, continuity) each have a tint and a dot token.

## Type

System UI (SF Pro) for chrome; New York/Iowan/Georgia for prose.

| Use | Token |
| --- | --- |
| Window title, welcome | `title-1` 28 / `large-title` 34 |
| Section headings | `title-2` 22, `title-3` 20 |
| Row and panel headings | `headline` 17 |
| Body copy | `body` 15 |
| Secondary copy, help text | `subheadline` 13 |
| Captions, metadata | `caption` 12, `caption-2` 11 tabular |

Manuscript is `--text-manuscript-size` 17 over 28; line numbers share the same leading so the gutter
aligns. Numbers in rails, headers and stats are tabular.

## Space, radius, elevation

4 px base: `space-1…6`, 8, 12. Window gutter `space-5`; gap between panels `space-4`; card padding
`space-5`; glass bar padding `space-3`.

Radii: 8 menu items, 10 buttons/inputs/rows, 14 cards and the composer, 20 glass panels, 26 dialogs,
full for pills. Nested corners follow outer − padding.

Shadows are limited to `--elevation-1` (fields), `--elevation-2` (cards), `--elevation-glass`
(anything glass), `--elevation-overlay` (menus, dialogs). If a surface needs a second shadow, the
layout is wrong.

## Layout

- Glass header floats 12 px from the top, full width, 44 px tall, with `titlebar-drag` on empty areas
  and `titlebar-no-drag` on controls. On macOS leave 92 px for the traffic lights.
- Workspace: 248 px chapter rail, centred manuscript sheet capped at 760 px, optional 400 px chat
  panel, 16 px gaps.
- Library: grid of cards, `minmax(252px, 1fr)`.
- Dialogs: 512 px wide, `glass-strong`, over a `.scrim` that blurs the window instead of dimming it.

## Targets and responsive layout

The reference devices are **iPhone** (393 × 852 logical points) and **iPad mini** (744 × 1133).
Desktop remains a first-class target at 1440 × 900, but the small layouts are designed first.

| Width | Layout |
| --- | --- |
| `< 700px` | One column. Compact header with back, title and save dot. Bottom action bar: Chapters, Search, Agent, More. Chapters open as a left drawer over a scrim. The agent is a full-screen sheet. Manuscript text is 16/26 with 20px side padding. |
| `700–999px` | Chapter rail beside the manuscript, compact header actions, agent still a full-screen sheet. This is iPad mini portrait. |
| `≥ 1000px` | Desktop three-pane workspace: 248px rail, centred 760px manuscript, optional 400px agent panel. |

- Breakpoints are 700px and 1000px, chosen around iPad mini portrait rather than generic phone/tablet
  defaults.
- The manuscript sheet is the only solid surface. The rail, header and bottom bar stay glass.
- Touch targets are at least 44px high; the bottom bar labels every icon.
- Dialogs are capped at `calc(100vw - 48px)` and stay usable at 393px.
- Keep the safe-area inset in mind for the Capacitor shell; do not place controls under the home
  indicator or notch.

## Voice

Plain, warm, second person. "We" only when speaking about privacy or storage. Sentence case
everywhere, including buttons and headings; Title Case only for the product name. No exclamation
marks in the interface. No emoji — use an icon.

- Buttons are verb + object: "Import library", "Add chapter", "Choose a folder".
- Help text is one sentence.
- Status lines join facts with middle dots: "1,478 words · 243 lines · Read-only".
- Errors say what happened and what to do next, without blame or jargon.
- Agents, when they arrive, speak in the first person and briefly.

## Accessibility

- Every interactive element is reachable by keyboard, shows a 2 px `--ring` focus ring, and has a
  name (`aria-label` when the icon stands alone).
- The save status is an `aria-live="polite"` region; conflicts are announced.
- `prefers-reduced-transparency` swaps glass for solid `--card`; `prefers-reduced-motion` removes
  transitions; `prefers-contrast: more` strengthens hairlines.
- `--muted-foreground` passes 4.5:1 on its intended ground; do not lighten it further.

## Checklist before shipping interface work

- [ ] All colours, radii and shadows come from tokens.
- [ ] Glass is used only for floating layers; the manuscript stays solid.
- [ ] One primary action per view.
- [ ] Sentence case, verb + object, middle dots for status.
- [ ] Light, dark, reduced transparency and keyboard-only all checked.
- [ ] The smoke test still passes (`bun run smoke`), since it types in a real window.
