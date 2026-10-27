# The glasses: the same backbone, a second surface

**Status:** Assessment, in progress (2026-10-26)
**Number:** 026
**Depends on:** [024](../024-agent-tool-parity/spec.md) the tool catalog, [018](../018-agent-toolkit/spec.md) the backend and MCP server.

## The question

Can the studio run on Meta's glasses, and can Meta's own assistant use the studio's
integrations? Or is it a dead end?

## The short answer

**Not a dead end, and the shape fits unusually well — but the glasses cannot reach the author's
own machine, so the first working version is about the sample book, not the author's book.**

Three separate official surfaces exist, and the studio's tool contract is already one-to-one with
all three:

| Surface | What it is | Cost |
| --- | --- | --- |
| **WebMCP** | A web page registers its actions as tools the glasses' assistant calls by voice, through `document.modelContext`. A Community Group standard, not a W3C standard, but implemented and stable on the glasses. | A static web page. No SDK, no native app, no store. |
| **Meta AI Connectors** | A service is exposed to the Meta AI assistant through an API or an MCP server. "No new SDK, no new app to ship." Works on the glasses, the Meta AI app and the web. | A public endpoint, OAuth account linking, and Meta's review. Developer preview. |
| **Device Access Toolkit (DAT) 1.0** | A native iOS or Android app drives the glasses: camera, microphone, speakers and the display. Stable since 30 September 2026. | A real phone app. The only surface that reaches the camera or the microphone. |

## The one hard constraint

**A Web App must be served from a publicly accessible HTTPS URL.** Meta's own documentation says
so: "HTTP-only URLs are not supported", and "you can also host from your own server, as long as it
serves the app over HTTPS with a valid TLS certificate". The glasses reach the internet through the
phone, so they cannot reach the author's laptop on `127.0.0.1` or on its LAN address either, and a
browser will not let an HTTPS page fetch an `http://` one.

So there are exactly two ways for prose to reach the glasses, and they are not the same product:

1. **Through a public endpoint.** The studio runs where the glasses can reach it. The connector
   route and the Web App route both need this.
2. **Through the phone.** The Device Access Toolkit app runs on the phone, the phone reaches the
   author's studio over the local network, and the phone pushes to the glasses over Bluetooth. This
   is the only route that keeps the author's book on the author's machine.

The second is the right long-term answer and the first is the only one that fits the event
window. That is why the first slice is about the **sample library**, which is already committed,
public and original.

## Why the contract already fits

The studio's `ToolDescriptor` is a name, a description, a JSON Schema and a tier. Meta's shapes
want the same fields:

| Studio | WebMCP | Meta AI connector |
| --- | --- | --- |
| `name` | `name` (ASCII, `_-.`, 1–128) | `name` |
| `description` | `description` | `description` |
| `inputSchema` | `inputSchema`, stringified JSON Schema | the arguments schema |
| `tier: "read"` | `annotations.readOnlyHint` | classification Read |
| `tier: "write"` | — | classification Write |
| `tier: "destructive"` | `annotations.consequentialHint` | a sensitive write |
| the tool's `execute` | the page's `execute` | the connector's endpoint |

Meta's connector guidelines ask for exactly this: a read/write classification, a sensitive
designation, the schemas, the side effects and how errors are reported. The studio already has a
tier that is *the same classification*, and a toolkit that already speaks MCP.

**The interchange was already chosen.** This is why the answer is not a dead end: the studio is not
being translated into Meta's shapes, it is being renamed into them.

`packages/core/src/agent/surfaces.ts` does the renaming, and `bookwriter tools --format webmcp`
and `--format connector` produce the two descriptions from a live studio.

## What the glasses can and cannot do

From Meta's Web Apps documentation, for the Ray-Ban Display:

| Capability | On a Web App | Note |
| --- | --- | --- |
| Display | 600×600, fixed, no scrolling | Additive waveguide: use a dark background and light text. |
| Input | D-pad (arrow keys, select, back), optional pinch-and-drag | No mouse, no touchscreen, no physical keyboard. |
| Text input | The on-glasses composer | The wearer speaks; the text lands in the field. |
| Speech out | `window.speechSynthesis`, through the glasses' speaker | One English voice, no permission prompt. |
| Camera | **Not supported** | DAT only. |
| Microphone | **Not supported** | DAT only. |
| Notifications | **Not supported** | — |

The microphone being absent is not a problem for the studio: dictation on the glasses is Meta's own
composer, and the text arrives in the field. The studio's Muse Voice Transcribe path stays on the
desktop.

## The three routes

### Route A — A Web App and WebMCP, against a public studio serving the sample (recommended)

A static page at 600×600 that shows the book, reads the current paragraph aloud, and registers the
studio's own tools with `document.modelContext` so the wearer can ask for them by voice.

- **It needs no native app and no SDK.** The page is plain HTML, CSS and JavaScript.
- **It can be developed entirely locally.** The Meta Ray-Ban Display Simulator is a Chrome
  extension that recreates the 600×600 display and the D-pad. In a desktop browser the page can
  call the studio on `127.0.0.1` exactly as it does now. Nothing public is needed to prove it.
- **On the real glasses**, the same page is served from a public HTTPS URL and points at a public
  instance of the studio serving the sample library. The page holds no prose; the prose comes from
  the studio over the connector's own fetch.
- **It never touches the author's own book.**

### Route B — A Meta AI Connector (prepare now, apply for access)

`bookwriter mcp` is already an MCP server over the studio's own tool catalog, which is the
interchange Meta named. A connector needs a public endpoint, OAuth account linking and Meta's
review: tool review, read/write classification, business verification, a data-processing
questionnaire, test credentials and an end-to-end QA pass. Access is granted "in waves", so
approval cannot be assumed for a date.

What can be done now, and is worth doing, is to have the manifest ready: the tool list, the
classifications, the scopes, the account-linking story. Applying is an email.

### Route C — A phone app with the Device Access Toolkit (the author's own book, later)

The only route that keeps the author's prose on the author's machine and still reaches the
glasses. It is also a native iOS/Android app, a store listing and a device setup, which is weeks
rather than days. It is the right answer for the author's own book and the wrong answer for an
eight-day event.

## Requirements for the chosen slice

- **FR-001** The studio's tool catalog MUST be renderable as a WebMCP tool list and as a Meta AI
  connector manifest, from a live studio, without a network.
- **FR-002** The WebMCP rendering MUST preserve the studio's names, descriptions and JSON Schemas,
  and MUST map the tiers onto `readOnlyHint` and `consequentialHint`.
- **FR-003** The connector rendering MUST classify every tool Read or Write, MUST mark the
  destructive ones sensitive, and MUST state the side effects and the error behaviour.
- **FR-004** A tool name that WebMCP would reject MUST be left out of the WebMCP list rather than
  mangled. A mangled name is a different tool, and the caller would call the wrong one.
- **FR-005** The Web App MUST work at 600×600 with no scrolling, with a dark background, and with
  the D-pad alone.
- **FR-006** Every action the Web App exposes as a WebMCP tool MUST also be reachable by hand in
  the interface. Meta's own rule: WebMCP is an accelerator, never the only path.
- **FR-007** The Web App MUST speak what it shows, through `window.speechSynthesis`, and MUST keep
  the text visible for the wearer who cannot or will not listen.
- **FR-008** The Web App MUST work without WebMCP, without speech and without a network, and MUST
  say so rather than fail silently.
- **FR-009** The author's own library MUST NOT be reachable from the glasses in this slice. The
  public instance serves the sample library only.
- **FR-010** The studio's own safety rules MUST hold on the glasses: a destructive tool is never
  exposed as a WebMCP tool without the author's approval, and a tool the author withdrew for the
  book is not exposed at all.

## Non-goals

- The camera and the microphone. They need the Device Access Toolkit.
- The glasses' own Meta AI as the writing agent. The assistant calls the studio's tools; it does
  not become the agent.
- A hosted copy of anyone's book. Including the author's.
- An app store release, a native app, or a store listing.

## Open decisions

- **D-154** The first slice is Route A, with the page served by the studio itself, so it is the
  same origin as the API and needs no public host. Accepted: the page holds no prose, and the
  token travels in the URL fragment, which a browser never sends to a server.
- **D-155** The connector manifest is produced now and the application is sent when the endpoint
  and the account-linking story exist. Access is a wave process, so the submission does not depend
  on it. Accepted.
- **D-156** The author's own book reaches the glasses only through the phone, in a later slice.
  Accepted: the alternative is a hosted copy, which the product's promise forbids.
- **D-157** No public instance of the studio is published. The author chose a local-network
  instance on their own machine. The consequence is stated plainly below.
- **D-160** The phone is the server and the glasses the client, through the Device Access
  Toolkit. Accepted: the toolkit sends UI content to the glasses over Bluetooth and routes the
  interactions back, and it is the only route that keeps the author's own book private.

## The consequence of D-157, stated plainly

**The glasses cannot fetch live prose from a private network.** A Web App must be loaded from a
public HTTPS URL, so its own requests are made from the public internet; a private address is
both unreachable through the phone's tether and refused by the browser's mixed-content rules. The
author's decision not to publish an instance therefore has one honest outcome:

- **On the computer, everything works.** The page is served by the studio, it reads the real
  book, it calls the real tools, and the whole thing is proven in a browser at 600×600 by
  `bun run glasses:check`.
- **On the glasses, the page can be loaded and shown** once the shell is hosted, because the
  shell holds no prose. What it cannot do is fetch the author's own book, because the studio is
  not on the public internet and will not be put there.
- **The author's own book reaches the glasses through the phone**, in the Device Access Toolkit
  slice: the phone app reaches the studio over the local network and pushes the interface to the
  glasses over Bluetooth. That is the route that needs no public endpoint, and it is a native
  app.

This is stated here so the submission never claims a live on-device read of a private book.

## What the WebMCP route depends on that this repository cannot promise

- Meta's glasses runtime, the Developer Mode in the Meta AI app, and WebMCP being on for the
  device. WebMCP is off by default and is enabled per device.
- A public HTTPS host for the shell. The shell holds no prose, so hosting it exposes nothing.
- A working microphone is not needed. The composer is enough.
- The simulator, for the part that can be done without the hardware.
