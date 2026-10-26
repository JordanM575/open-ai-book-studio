# Plan: the glasses

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## The shapes

The studio's catalog is rendered into the two shapes Meta named, in
`packages/core/src/agent/surfaces.ts`:

- `webMcpTools(catalog)` — the WebMCP tool list a page registers with `document.modelContext`.
- `connectorManifest(catalog)` — the Meta AI connector manifest, with every tool classified.

Both are pure functions over `ToolDescriptor[]`, so they live in `packages/core` next to the
contract they describe and can be tested without a library, a backend or a network.

`bookwriter tools --format webmcp` and `--format connector` produce them from a live studio, so
the manifest describes the tools the studio is actually running rather than a copy of them.

## The Web App

A static page. No framework, no build step, no SDK.

```
glasses/
  index.html          the page: 600x600, dark, no scrolling
  app.js              the tools, the WebMCP registration, the speech
  manifest.json       the web app manifest Meta's runtime looks for
```

The page is written to the glasses' constraints rather than to a browser's:

- A fixed 600×600 viewport with `overflow: hidden`. No scrolling, because the D-pad has no scroll
  affordance the wearer can see.
- A dark background. The display is an additive waveguide: black adds no light and disappears, and
  a bright background glares.
- Every interactive element is focusable and reachable with the arrow keys, and the D-pad handler
  moves focus in a ring.
- The text is shown as well as spoken. `speechSynthesis` plays through the glasses' speaker, but
  the wearer must be able to read it too.
- Every feature is feature-detected: `document.modelContext`, `speechSynthesis`, `fetch`. The page
  works without WebMCP and says so, because WebMCP is off by default on most devices.

## Reaching the studio

**For the local demonstration**, the desktop app's existing loopback backend is the studio. The
page runs in the simulator, in a desktop browser, and calls it directly.

The backend currently refuses every request that carries an `Origin` header, and refuses a `Host`
that is not loopback. A browser page needs the first to be allowed for its own origin, and needs
CORS headers on the reply. The change is deliberately narrow:

- It is **off by default**. The author turns it on in Settings and the app prints the origin to
  allow and the URL to open.
- The allow-list holds **exact origins**, never a wildcard, and never `*` with credentials.
- Only the origins the author named are answered; every other origin is refused as it is now.
- The token stays the same per-run token. The page carries it, and the token is still a secret
  that never leaves the author's machine.

This is the same rule the studio already follows for the browser build: the app never accepts a
browser origin by default.

**For the real glasses**, the page has to be served from a public HTTPS URL, and the prose has to
come from a public instance of the studio serving the sample library. That is a separate decision
(D-157) and a separate piece of work: it needs a headless server, which means the tool
definitions and the library opener moving down into `packages/core` so a non-Electron process can
host them. That is a real refactor of the studio's most safety-critical file, and it is not worth
doing under an event deadline without the film finished.

## Verification

- `bun test` for the surface mapping: the names, the schemas, the classifications, the
  sensitive marks and the name that WebMCP would reject.
- A test that the backend refuses an origin that is not on the list, and answers the ones that are.
- The simulator, for the layout and the D-pad.
- The real glasses, for the last mile, once the page is hosted.
