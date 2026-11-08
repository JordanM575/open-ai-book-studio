import { expect, test } from "bun:test";
import type { AudioGrant } from "../../../packages/core/src/voice-session";
import {
  AudioGrantRegistry,
  type PermissionSender,
  type PermissionWindow,
  trustedRendererOrigin,
  VoicePermissionOwner
} from "../src/main/voice-permissions";

/*
 * Synthetic Electron stand-ins only: no BrowserWindow, session, microphone or OS prompt is used.
 * The owner reads the same structural facts the real callbacks expose, so these tests exercise the
 * host decision and the ephemeral grant registry rather than Electron itself.
 */

const HOST_ID = "synthetic-host";
const TRUSTED_ORIGIN = "http://localhost:5173";
const STUDIO_WINDOW_ID = 7;
const STUDIO_CONTENTS_ID = 101;
const STUDIO_FRAME_ID = 42;
const FOREIGN_WINDOW_ID = 8;
const FOREIGN_CONTENTS_ID = 202;

function sender(id = STUDIO_CONTENTS_ID, routingId: number | null = STUDIO_FRAME_ID): PermissionSender {
  return { id, mainFrame: routingId === null ? null : { routingId } };
}

function harness(options: { trustedOrigin?: string | null } = {}) {
  let now = 1_000;
  let studioWindow: PermissionWindow | null = { id: STUDIO_WINDOW_ID, webContents: sender() };
  const foreignWindow: PermissionWindow = { id: FOREIGN_WINDOW_ID, webContents: sender(FOREIGN_CONTENTS_ID) };
  const registry = new AudioGrantRegistry(() => now);
  const owner = new VoicePermissionOwner({
    hostId: HOST_ID,
    trustedOrigin: options.trustedOrigin === undefined ? TRUSTED_ORIGIN : options.trustedOrigin,
    currentWindow: () => studioWindow,
    windowForContents: (contents) => {
      if (studioWindow && contents.id === studioWindow.webContents.id) return studioWindow;
      if (contents.id === foreignWindow.webContents.id) return foreignWindow;
      return null;
    },
    registry
  });
  return {
    owner,
    registry,
    foreignWindow,
    get studioWindow(): PermissionWindow | null {
      return studioWindow;
    },
    closeStudioWindow(): void {
      studioWindow = null;
    },
    setNow(value: number): void {
      now = value;
    }
  };
}

function checkFacts(overrides: Record<string, unknown> = {}) {
  return {
    isMainFrame: true,
    securityOrigin: TRUSTED_ORIGIN,
    mediaType: "audio",
    ...overrides
  };
}

function requestFacts(overrides: Record<string, unknown> = {}) {
  return {
    isMainFrame: true,
    securityOrigin: TRUSTED_ORIGIN,
    requestingUrl: `${TRUSTED_ORIGIN}/`,
    mediaTypes: ["audio"],
    ...overrides
  };
}

function grant(overrides: Partial<AudioGrant> = {}): AudioGrant {
  return {
    sessionId: "synthetic-session",
    generation: 1,
    grantId: "synthetic-grant-1",
    hostId: HOST_ID,
    windowId: String(STUDIO_WINDOW_ID),
    frameId: String(STUDIO_FRAME_ID),
    origin: TRUSTED_ORIGIN,
    active: true,
    audioOnly: true,
    expiresAt: 100_000,
    ...overrides
  };
}

test("the trusted studio main frame keeps push-to-talk audio and creates no grant", () => {
  const h = harness();
  const contents = h.studioWindow?.webContents as PermissionSender;

  expect(h.owner.check(contents, "media", TRUSTED_ORIGIN, checkFacts())).toBe(true);
  expect(h.owner.request(contents, "media", requestFacts())).toBe(true);
  expect(h.owner.decide({
    senderContentsId: contents.id,
    senderWindowId: String(STUDIO_WINDOW_ID),
    frameId: String(STUDIO_FRAME_ID),
    topLevel: true,
    origin: TRUSTED_ORIGIN,
    permission: "media",
    mediaTypes: ["audio"]
  })).toEqual({ captureAllowed: true, handsFree: false, reason: "push-to-talk" });

  // Push-to-talk is an explicit press, not a hands-free session: nothing was registered.
  expect(h.registry.current()).toBeNull();
  expect(h.owner.activeHandsFreeGrant()).toBeNull();
});

test.each([
  { name: "foreign sender", sender: sender(FOREIGN_CONTENTS_ID), details: checkFacts() },
  { name: "foreign frame", sender: sender(STUDIO_CONTENTS_ID, 99), details: checkFacts() },
  { name: "subframe", sender: sender(), details: checkFacts({ isMainFrame: false }) },
  { name: "missing frame", sender: sender(STUDIO_CONTENTS_ID, null), details: checkFacts() },
  { name: "foreign origin", sender: sender(), details: checkFacts({ securityOrigin: "https://foreign.invalid" }) },
  { name: "missing origin", sender: sender(), details: { isMainFrame: true, mediaType: "audio" }, origin: "" },
  { name: "camera", sender: sender(), details: checkFacts({ mediaType: "video" }) },
  { name: "unknown media", sender: sender(), details: checkFacts({ mediaType: "unknown" }) },
  { name: "missing media", sender: sender(), details: { isMainFrame: true, securityOrigin: TRUSTED_ORIGIN } },
  { name: "missing details", sender: sender(), details: null }
])("check handler denies $name", ({ sender: observed, details, origin }) => {
  const h = harness();
  expect(h.owner.check(observed, "media", origin ?? TRUSTED_ORIGIN, details)).toBe(false);
});

test("check handler denies a nullable sender and a non-media permission", () => {
  const h = harness();
  expect(h.owner.check(null, "media", TRUSTED_ORIGIN, checkFacts())).toBe(false);
  expect(h.owner.check(sender(), "geolocation", TRUSTED_ORIGIN, checkFacts())).toBe(false);
  expect(h.owner.check(sender(), "notifications", TRUSTED_ORIGIN, checkFacts())).toBe(false);
});

test.each([
  { name: "foreign sender", sender: sender(FOREIGN_CONTENTS_ID), details: requestFacts() },
  { name: "foreign frame", sender: sender(STUDIO_CONTENTS_ID, 99), details: requestFacts() },
  { name: "subframe", sender: sender(), details: requestFacts({ isMainFrame: false }) },
  { name: "foreign origin", sender: sender(), details: requestFacts({ securityOrigin: "https://foreign.invalid" }) },
  { name: "mismatched origin fields", sender: sender(), details: requestFacts({ requestingUrl: "https://foreign.invalid/" }) },
  { name: "camera", sender: sender(), details: requestFacts({ mediaTypes: ["video"] }) },
  { name: "mixed media", sender: sender(), details: requestFacts({ mediaTypes: ["audio", "video"] }) },
  { name: "duplicate audio", sender: sender(), details: requestFacts({ mediaTypes: ["audio", "audio"] }) },
  { name: "empty media", sender: sender(), details: requestFacts({ mediaTypes: [] }) },
  { name: "display capture", sender: sender(), details: requestFacts({ mediaTypes: ["audio", "display"] }) },
  { name: "missing media", sender: sender(), details: requestFacts({ mediaTypes: undefined }) },
  { name: "missing details", sender: sender(), details: null }
])("request handler denies $name", ({ sender: observed, details }) => {
  const h = harness();
  expect(h.owner.request(observed, "media", details)).toBe(false);
});

test("a foreign window is denied even when its contents look like the studio's", () => {
  const h = harness();
  const lookalike: PermissionSender = { id: FOREIGN_CONTENTS_ID, mainFrame: { routingId: STUDIO_FRAME_ID } };
  expect(h.owner.check(lookalike, "media", TRUSTED_ORIGIN, checkFacts())).toBe(false);
  expect(h.owner.request(lookalike, "media", requestFacts())).toBe(false);
});

test("the exact active hands-free grant allows audio and is reported as hands-free", () => {
  const h = harness();
  const contents = h.studioWindow?.webContents as PermissionSender;
  expect(h.owner.registerHandsFreeGrant(grant())).toBe(true);
  expect(h.owner.check(contents, "media", TRUSTED_ORIGIN, checkFacts())).toBe(true);
  expect(h.owner.request(contents, "media", requestFacts())).toBe(true);
  expect(h.owner.activeHandsFreeGrant()?.grantId).toBe("synthetic-grant-1");

  const observation = {
    senderWindowId: String(STUDIO_WINDOW_ID),
    senderHostId: HOST_ID,
    frameId: String(STUDIO_FRAME_ID),
    topLevel: true,
    origin: TRUSTED_ORIGIN,
    permission: "media",
    mediaTypes: ["audio"]
  } as const;
  expect(h.registry.permits(observation)).toBe(true);
  expect(h.registry.permits(observation, { sessionId: "synthetic-session", generation: 1 })).toBe(true);
  // The grant binds its exact session token and generation.
  expect(h.registry.permits(observation, { sessionId: "other-session", generation: 1 })).toBe(false);
  expect(h.registry.permits(observation, { sessionId: "synthetic-session", generation: 2 })).toBe(false);

  expect(h.owner.decide({
    senderContentsId: contents.id,
    senderWindowId: String(STUDIO_WINDOW_ID),
    frameId: String(STUDIO_FRAME_ID),
    topLevel: true,
    origin: TRUSTED_ORIGIN,
    permission: "media",
    mediaTypes: ["audio"]
  })).toEqual({ captureAllowed: true, handsFree: true, reason: "hands-free" });
});

test("an expired grant stops hands-free while trusted push-to-talk still works", () => {
  const h = harness();
  const contents = h.studioWindow?.webContents as PermissionSender;
  expect(h.owner.registerHandsFreeGrant(grant({ expiresAt: 2_000 }))).toBe(true);
  h.setNow(2_000);
  expect(h.owner.activeHandsFreeGrant()).toBeNull();
  expect(h.owner.check(contents, "media", TRUSTED_ORIGIN, checkFacts())).toBe(true);
  expect(h.owner.decide({
    senderContentsId: contents.id,
    senderWindowId: String(STUDIO_WINDOW_ID),
    frameId: String(STUDIO_FRAME_ID),
    topLevel: true,
    origin: TRUSTED_ORIGIN,
    permission: "media",
    mediaTypes: ["audio"]
  })).toEqual({ captureAllowed: true, handsFree: false, reason: "push-to-talk" });
});

test("an already expired or malformed grant is not registered", () => {
  const h = harness();
  expect(h.owner.registerHandsFreeGrant(grant({ expiresAt: 999 }))).toBe(false);
  expect(h.owner.registerHandsFreeGrant(grant({ audioOnly: false }))).toBe(false);
  expect(h.owner.registerHandsFreeGrant(grant({ active: false }))).toBe(false);
  expect(h.owner.registerHandsFreeGrant(grant({ generation: -1 }))).toBe(false);
  expect(h.owner.registerHandsFreeGrant(grant({ expiresAt: Number.POSITIVE_INFINITY }))).toBe(false);
  expect(h.owner.registerHandsFreeGrant(grant({ origin: "" }))).toBe(false);
  expect(h.registry.current()).toBeNull();
});

test("register refuses a second live grant; replace and revoke act on the exact grant", () => {
  const h = harness();
  const first = grant();
  const second = grant({ grantId: "synthetic-grant-2", generation: 2 });
  expect(h.owner.registerHandsFreeGrant(first)).toBe(true);
  expect(h.owner.registerHandsFreeGrant(second)).toBe(false);
  expect(h.owner.activeHandsFreeGrant()?.grantId).toBe(first.grantId);
  expect(h.owner.replaceHandsFreeGrant(second)).toBe(true);
  expect(h.owner.activeHandsFreeGrant()?.grantId).toBe(second.grantId);
  expect(h.owner.revokeHandsFreeGrant("different-grant")).toBe(false);
  expect(h.owner.activeHandsFreeGrant()?.grantId).toBe(second.grantId);
  expect(h.owner.revokeHandsFreeGrant(second.grantId)).toBe(true);
  expect(h.owner.activeHandsFreeGrant()).toBeNull();
  expect(h.owner.registerHandsFreeGrant(first)).toBe(true);
  h.owner.clearHandsFreeGrants();
  expect(h.registry.current()).toBeNull();
});

test("closing the bound studio window revokes only its grant", () => {
  const h = harness();
  expect(h.owner.registerHandsFreeGrant(grant())).toBe(true);
  expect(h.owner.windowClosed(String(FOREIGN_WINDOW_ID))).toBe(false);
  expect(h.owner.activeHandsFreeGrant()?.grantId).toBe("synthetic-grant-1");
  expect(h.owner.windowClosed(String(STUDIO_WINDOW_ID))).toBe(true);
  expect(h.owner.activeHandsFreeGrant()).toBeNull();
  expect(h.registry.current()).toBeNull();

  h.closeStudioWindow();
  expect(h.owner.check(sender(), "media", TRUSTED_ORIGIN, checkFacts())).toBe(false);
  expect(h.owner.request(sender(), "media", requestFacts())).toBe(false);
});

test("both real handlers share the single decide path", () => {
  const h = harness();
  const seen: string[] = [];
  const decide = h.owner.decide.bind(h.owner);
  h.owner.decide = (facts) => {
    seen.push(`${facts.permission}:${facts.topLevel}:${facts.mediaTypes.join(",")}`);
    return decide(facts);
  };
  const contents = h.studioWindow?.webContents as PermissionSender;
  expect(h.owner.check(contents, "media", TRUSTED_ORIGIN, checkFacts())).toBe(true);
  expect(h.owner.request(contents, "media", requestFacts())).toBe(true);
  expect(seen).toEqual(["media:true:audio", "media:true:audio"]);
});

test("both handlers return the same allow/deny outcome for equivalent facts", () => {
  const h = harness();
  const contents = h.studioWindow?.webContents as PermissionSender;
  const cases: Array<[string, boolean]> = [
    ["media", true],
    ["geolocation", false],
    ["notifications", false]
  ];
  for (const [permission, expected] of cases) {
    expect(h.owner.check(contents, permission, TRUSTED_ORIGIN, checkFacts())).toBe(expected);
    expect(h.owner.request(contents, permission, requestFacts())).toBe(expected);
  }
});

test("trustedRendererOrigin derives the exact development and packaged origins", () => {
  expect(trustedRendererOrigin({ devServerUrl: "http://localhost:5173/", rendererFile: "/unused/index.html" }))
    .toBe("http://localhost:5173");
  expect(trustedRendererOrigin({ devServerUrl: "https://studio.example/path", rendererFile: "/unused/index.html" }))
    .toBe("https://studio.example");
  expect(trustedRendererOrigin({ devServerUrl: "not a url", rendererFile: "/unused/index.html" })).toBeNull();
  expect(trustedRendererOrigin({ devServerUrl: "file:///tmp/index.html", rendererFile: "/unused/index.html" })).toBeNull();
  expect(trustedRendererOrigin({ rendererFile: "/app/out/renderer/index.html" })).toBe("file://");
  expect(trustedRendererOrigin({ rendererFile: "C:\\app\\renderer\\index.html" })).toBe("file://");
  expect(trustedRendererOrigin({ rendererFile: "relative/index.html" })).toBeNull();
  expect(trustedRendererOrigin({ rendererFile: "" })).toBeNull();
});

test("a packaged file renderer is trusted by its file origin, not by a wildcard", () => {
  const h = harness({ trustedOrigin: "file://" });
  const contents = h.studioWindow?.webContents as PermissionSender;
  expect(h.owner.check(contents, "media", "file://", {
    isMainFrame: true,
    securityOrigin: "file://",
    mediaType: "audio"
  })).toBe(true);
  expect(h.owner.request(contents, "media", {
    isMainFrame: true,
    securityOrigin: "file://",
    requestingUrl: "file:///app/out/renderer/index.html",
    mediaTypes: ["audio"]
  })).toBe(true);
  expect(h.owner.check(contents, "media", "https://foreign.invalid", {
    isMainFrame: true,
    securityOrigin: "https://foreign.invalid",
    mediaType: "audio"
  })).toBe(false);
});

/*
 * Review findings F1–F3 (2026-11-08): a present-but-unrecognised origin denies, a same-id
 * re-registration cannot rebind a live grant, and a clock that moves backwards cannot revive one.
 */
test("a present but unrecognised origin field denies instead of deferring to the other field", () => {
  const { owner } = harness();
  for (const bad of ["", "   ", "not a url", "chrome-extension://abc", 42, {}]) {
    expect(owner.check(sender(), "media", bad as unknown as string, checkFacts() as never)).toBe(false);
    expect(owner.check(sender(), "media", `${TRUSTED_ORIGIN}/`, checkFacts({ securityOrigin: bad }) as never)).toBe(false);
    expect(owner.request(sender(), "media", requestFacts({ securityOrigin: bad }) as never)).toBe(false);
    expect(owner.request(sender(), "media", requestFacts({ requestingUrl: bad }) as never)).toBe(false);
  }
  // An absent field still defers to the present one (an empty string is present, so it denies).
  expect(owner.check(sender(), "media", undefined as unknown as string, checkFacts() as never)).toBe(true);
  expect(owner.request(sender(), "media", { isMainFrame: true, mediaTypes: ["audio"], requestingUrl: `${TRUSTED_ORIGIN}/` } as never)).toBe(true);
});

test("re-registering the same grant id with a different binding is refused", () => {
  const { owner, registry } = harness();
  const first = grant();
  expect(owner.registerHandsFreeGrant(first)).toBe(true);
  expect(owner.registerHandsFreeGrant(grant())).toBe(true);

  const rebinds = [
    grant({ expiresAt: 200_000 }),
    grant({ origin: "http://foreign.example" }),
    grant({ windowId: String(FOREIGN_WINDOW_ID) }),
    grant({ sessionId: "other-session" }),
    grant({ generation: 2 }),
    grant({ frameId: "99" }),
    grant({ hostId: "other-host" })
  ];
  for (const changed of rebinds) {
    expect(owner.registerHandsFreeGrant(changed)).toBe(false);
    expect(registry.active()).toEqual(first);
  }

  // Only the explicit generation change may rebind.
  expect(owner.replaceHandsFreeGrant(grant({ generation: 2, expiresAt: 200_000 }))).toBe(true);
  expect(registry.active()?.generation).toBe(2);
});

test("an observed expiry cannot be revived by a clock that moves backwards", () => {
  const { owner, registry, setNow } = harness();
  const value = grant({ expiresAt: 2_000 });
  expect(owner.registerHandsFreeGrant(value)).toBe(true);
  expect(registry.active()?.grantId).toBe(value.grantId);

  setNow(2_000);
  expect(registry.active()).toBeNull();
  setNow(1_000);
  expect(registry.active()).toBeNull();
  expect(registry.permits({
    senderWindowId: String(STUDIO_WINDOW_ID),
    senderHostId: HOST_ID,
    frameId: String(STUDIO_FRAME_ID),
    topLevel: true,
    origin: TRUSTED_ORIGIN,
    permission: "media",
    mediaTypes: ["audio"]
  })).toBe(false);

  // An explicit new grant is still possible after a lapse.
  expect(owner.replaceHandsFreeGrant(grant({ expiresAt: 5_000 }))).toBe(true);
  expect(registry.active()?.grantId).toBe(value.grantId);
});
