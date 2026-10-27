# 0004 — The design kit is vendored and compiled, not copied by hand

- **Status:** Accepted

## Context

The interface must match the AI Book Studio design kit (Liquid Glass v20) precisely: it was designed
as a whole, and ad-hoc colours or one-off shadows immediately look wrong next to it. The kit ships
`tokens.json`, component previews and a compiled bundle for a static canvas — none of which is a
build step for a real app.

## Decision

`design/tokens.json` is a verbatim copy of the kit's tokens. `scripts/build-tokens.mjs` (no
dependencies) resolves primitive references, then emits
`packages/ui/src/styles/tokens.generated.css`:

- `:root` with primitives and the light theme,
- `[data-theme="dark"]` overrides,
- type families and the type scale,
- spacing, radius, size, duration, breakpoint and elevation variables,
- an `@theme inline` block mapping semantic colours to Tailwind's `--color-*` and radii to
  `--radius-*`, so utilities such as `bg-glass` and `text-muted-foreground` exist.

`base.css` adds only the structural classes the kit defines (`.window-wash`, `.glass`,
`.glass-strong`, `.glass-dialog`, `.scrim`, `.hairline`, `.manuscript`, `.chapter-title`) and the
accessibility media queries. Generated CSS is never edited by hand; it is committed so a fresh clone
builds without running the generator.

## Consequences

Positive: one source of truth for every visual value; Tailwind utilities stay semantic; dark mode is
a token swap; reduced transparency and motion are handled centrally; a kit update is a file copy plus
`pnpm tokens`.

Negative: the generator must understand any new token shape the kit introduces; class names in the
kit's HTML previews (`class-name`) do not transfer; the kit's compiled JS bundle is not used, so
components are reimplemented against the tokens and reviewed against the previews.

Rejected alternatives: importing the kit's bundle (React 18, CDN globals, not tree-shakeable);
hand-copying hex values into Tailwind config (drifts immediately); a component library restyle
(fights the kit's glass specularity and elevation).
