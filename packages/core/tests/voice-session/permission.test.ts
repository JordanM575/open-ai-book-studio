import { expect, test } from "bun:test";
import { activeAudioGrant, type PermissionAuthority, type PermissionObservation, permitsAudio } from "../../src/voice-session";
import { binding, grant, token } from "./fixtures";

const authority = (): PermissionAuthority => ({ studio: binding(), token, grant: grant(), now: 1_000, captureRequested: true });
const observed = (): PermissionObservation => ({
  senderWindowId: "studio-window", senderHostId: "synthetic-host", frameId: "trusted-main",
  topLevel: true, origin: "studio://trusted", permission: "media", mediaTypes: ["audio"],
});

test("only the actual studio top-level sender and active audio-only grant permit audio", () => {
  expect(permitsAudio(authority(), observed())).toBe(true);
});

test.each([
  { senderWindowId: null }, { senderWindowId: "foreign" }, { senderHostId: null }, { senderHostId: "foreign" },
  { frameId: null }, { frameId: "child" }, { topLevel: false }, { origin: null }, { origin: "https://foreign.invalid" },
  { permission: "display-capture" }, { mediaTypes: [] }, { mediaTypes: ["video"] },
  { mediaTypes: ["audio", "video"] }, { mediaTypes: ["audio", "display"] }, { mediaTypes: ["audio", "audio"] },
])("denies foreign/missing sender, frame or media facts: %j", (patch) => {
  expect(permitsAudio(authority(), { ...observed(), ...patch })).toBe(false);
});

test.each([
  { grant: null }, { captureRequested: false }, { now: NaN }, { now: -1 }, { now: 100_000 },
  { grant: { ...grant(), active: false } }, { grant: { ...grant(), audioOnly: false } },
  { grant: { ...grant(), generation: 0 } }, { grant: { ...grant(), expiresAt: Infinity } },
  { grant: { ...grant(), origin: "foreign" } }, { grant: { ...grant(), windowId: "foreign" } },
  { grant: { ...grant(), frameId: "foreign" } }, { grant: { ...grant(), hostId: "foreign" } },
  { grant: { ...grant(), grantId: "" } }, { token: { ...token, generation: Number.MAX_SAFE_INTEGER + 1 } },
])("denies invalid or revoked authority: %j", (patch) => {
  expect(activeAudioGrant({ ...authority(), ...patch })).toBe(false);
  expect(permitsAudio({ ...authority(), ...patch }, observed())).toBe(false);
});

test("renderer-looking values cannot substitute for a host grant", () => {
  const rendererClaims = { ...observed(), grant: grant(), captureRequested: true };
  expect(permitsAudio({ ...authority(), grant: null }, rendererClaims)).toBe(false);
});
