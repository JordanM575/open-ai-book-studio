import {
  type AudioGrant,
  activeAudioGrant,
  identifier,
  type PermissionAuthority,
  type PermissionObservation as CorePermissionObservation,
  permitsAudio,
  safeCounter,
  sameToken,
  type SessionToken
} from "../../../../packages/core/src/voice-session";

/*
 * One main-process owner for Electron's two default-session permission callbacks.
 *
 * The callbacks describe what Chromium observed, not what the renderer asked for. Every decision
 * is built from those callback facts and the studio's own window: a missing or contradictory
 * sender, frame, origin or media list denies. The renderer never supplies authority.
 *
 * Two audio paths share the same decision:
 *
 * - Push-to-talk keeps its existing behaviour: the actual studio window's trusted top-level frame
 *   may capture audio only. It creates no grant and never becomes a hands-free session.
 * - Hands-free audio additionally needs an exact ephemeral grant, checked through the pure
 *   `permitsAudio`/`activeAudioGrant` predicates. The future host adapter owns that grant; this
 *   slice only keeps it in memory and exposes no IPC or preload surface.
 *
 * Camera, display capture, geolocation, notifications, subframes, foreign windows/frames/origins
 * and mixed media all deny. The PDF export session keeps its separate deny-all handlers.
 */

/** The parts of Electron's WebContents this owner reads. A test supplies synthetic stand-ins. */
export interface PermissionSender {
  readonly id: number;
  readonly mainFrame?: { readonly routingId: number } | null;
}

/** The parts of Electron's BrowserWindow this owner reads. */
export interface PermissionWindow {
  readonly id: number;
  readonly webContents: PermissionSender;
}

/** Details from `setPermissionCheckHandler`; fields are optional in Electron's own contract. */
export interface CheckPermissionDetails {
  readonly isMainFrame?: boolean;
  readonly requestingUrl?: string;
  readonly securityOrigin?: string;
  readonly mediaType?: unknown;
  readonly mediaTypes?: unknown;
}

/** Details from `setPermissionRequestHandler` (a MediaAccessPermissionRequest for media). */
export interface RequestPermissionDetails {
  readonly isMainFrame?: boolean;
  readonly requestingUrl?: string;
  readonly securityOrigin?: string;
  readonly mediaType?: unknown;
  readonly mediaTypes?: unknown;
}

/** Raw callback facts. Nothing here is copied from a renderer message. */
export interface PermissionFacts {
  readonly senderContentsId: number | null;
  readonly senderWindowId: string | null;
  readonly frameId: string | null;
  readonly topLevel: boolean;
  readonly origin: string | null;
  readonly permission: string;
  readonly mediaTypes: readonly string[];
}

export type VoicePermissionDenial =
  | "missing-trusted-window"
  | "untrusted-sender"
  | "untrusted-window"
  | "untrusted-frame"
  | "missing-origin"
  | "untrusted-origin"
  | "not-media"
  | "not-audio-only";

export type VoicePermissionReason = VoicePermissionDenial | "push-to-talk" | "hands-free";

export interface VoicePermissionDecision {
  readonly allow: boolean;
  readonly handsFree: boolean;
  readonly reason: VoicePermissionReason;
}

/**
 * The real origin of the studio renderer, from the two paths `index.ts` actually loads.
 *
 * A development run uses the electron-vite server's exact `http(s)` origin. A packaged run loads
 * the bundled `renderer/index.html` through `file:`, whose Chromium origin is `file://`. There is
 * no wildcard and no `*` fallback: an unparseable server URL or a non-absolute renderer path
 * yields `null`, and every permission then denies.
 */
export function trustedRendererOrigin(input: {
  readonly devServerUrl?: string | undefined;
  readonly rendererFile: string;
}): string | null {
  if (input.devServerUrl !== undefined && input.devServerUrl.length > 0) {
    const origin = normalizeOrigin(input.devServerUrl);
    return origin !== null && /^https?:\/\//.test(origin) ? origin : null;
  }
  if (!isAbsolutePath(input.rendererFile)) return null;
  return "file://";
}

function isAbsolutePath(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\"));
}

/**
 * One origin from two callback fields. If both are present they must agree; a disagreement is
 * ambiguous and denies rather than picking the friendlier value.
 */
function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (value === "file://") return "file://";
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return "file://";
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    return null;
  }
  return null;
}

function originFromFacts(primary: unknown, secondary: unknown): string | null {
  const first = normalizeOrigin(primary);
  const second = normalizeOrigin(secondary);
  if (first !== null && second !== null) return first === second ? first : null;
  return first ?? second;
}

/** Exactly the callback's media list; duplicates and extra types stay visible to the decision. */
function mediaTypesFrom(details: CheckPermissionDetails | RequestPermissionDetails | null): readonly string[] {
  if (!details) return [];
  const single = details.mediaType === undefined
    ? null
    : typeof details.mediaType === "string" && details.mediaType.length > 0
      ? [details.mediaType]
      : [];
  const many = details.mediaTypes === undefined
    ? null
    : Array.isArray(details.mediaTypes) &&
        details.mediaTypes.every((type): type is string => typeof type === "string" && type.length > 0)
      ? details.mediaTypes
      : [];
  if (single && many) {
    return single.length === many.length && single.every((type, index) => type === many[index]) ? single : [];
  }
  return single ?? many ?? [];
}

function frameIdentity(contents: PermissionSender): string | null {
  const routingId = contents.mainFrame?.routingId;
  return typeof routingId === "number" && safeCounter(routingId) ? String(routingId) : null;
}

interface TrustedStudio {
  readonly hostId: string;
  readonly contentsId: number;
  readonly windowId: string;
  readonly frameId: string;
  readonly origin: string;
}

/**
 * The ephemeral, main-only hands-free capture grants.
 *
 * One exact grant lives in memory at a time. Registering a different grant while another is still
 * active is refused; `replace` is the explicit generation change. Expiry uses the injected clock.
 * There is no file, no IPC channel and no preload bridge, and this class never creates a grant by
 * itself.
 */
export class AudioGrantRegistry {
  private grant: AudioGrant | null = null;

  constructor(private readonly now: () => number) {}

  /** Keep the exact grant when the slot is empty or already this grant; false otherwise. */
  register(grant: AudioGrant): boolean {
    if (!this.valid(grant)) return false;
    const current = this.active();
    if (current && current.grantId !== grant.grantId) return false;
    this.grant = grant;
    return true;
  }

  /** Replace the slot explicitly, for a new session generation or an exact re-issue. */
  replace(grant: AudioGrant): boolean {
    if (!this.valid(grant)) return false;
    this.grant = grant;
    return true;
  }

  /** Revoke only the named grant; a mismatched id leaves the current grant alone. */
  revoke(grantId: string): boolean {
    if (!identifier(grantId) || this.grant?.grantId !== grantId) return false;
    this.grant = null;
    return true;
  }

  clear(): void {
    this.grant = null;
  }

  /** The stored grant, even after expiry or revocation facts change; for attributable cleanup. */
  current(): AudioGrant | null {
    return this.grant;
  }

  /** The grant only while every fact, its token/generation and its expiry still hold. */
  active(): AudioGrant | null {
    const grant = this.grant;
    if (!grant) return null;
    return activeAudioGrant(authorityFor(grant, this.now())) ? grant : null;
  }

  /** True only for the exact active grant and an audio-only observation from its binding. */
  permits(observation: CorePermissionObservation, expected?: SessionToken): boolean {
    const grant = this.active();
    if (!grant) return false;
    if (expected && !sameToken(grant, expected)) return false;
    return permitsAudio(authorityFor(grant, this.now()), observation);
  }

  /** A studio window closed: revoke only that window's grant. */
  windowClosed(windowId: string): boolean {
    if (!identifier(windowId) || this.grant?.windowId !== windowId) return false;
    this.grant = null;
    return true;
  }

  private valid(grant: AudioGrant): boolean {
    const now = this.now();
    return !!grant && typeof grant === "object" && grant.active === true && grant.audioOnly === true &&
      [grant.grantId, grant.sessionId, grant.hostId, grant.windowId, grant.frameId, grant.origin].every(identifier) &&
      safeCounter(grant.generation) && safeCounter(grant.expiresAt) && safeCounter(now) && grant.expiresAt > now;
  }
}

function authorityFor(grant: AudioGrant, now: number): PermissionAuthority {
  return {
    studio: { hostId: grant.hostId, windowId: grant.windowId, frameId: grant.frameId, origin: grant.origin },
    token: { sessionId: grant.sessionId, generation: grant.generation },
    grant,
    now,
    captureRequested: true
  };
}

export interface VoicePermissionOwnerOptions {
  /** Stable host identity for the studio process, not a renderer value. */
  readonly hostId: string;
  /** `trustedRendererOrigin(...)`; null denies every request. */
  readonly trustedOrigin: string | null;
  /** The studio's current window, or null after it closes. */
  readonly currentWindow: () => PermissionWindow | null;
  /** Optional real `BrowserWindow.fromWebContents`; defaults to matching the current window. */
  readonly windowForContents?: (contents: PermissionSender) => PermissionWindow | null;
  readonly registry: AudioGrantRegistry;
}

/**
 * Both Electron callbacks pass through `decide`. `check` answers the synchronous boolean handler;
 * `request` answers the callback handler with the same decision. Neither creates a grant.
 */
export class VoicePermissionOwner {
  private readonly registry: AudioGrantRegistry;

  constructor(private readonly options: VoicePermissionOwnerOptions) {
    this.registry = options.registry;
  }

  check(
    contents: PermissionSender | null,
    permission: string,
    requestingOrigin: string,
    details: CheckPermissionDetails | null
  ): boolean {
    return this.decide(this.observeCheck(contents, permission, requestingOrigin, details)).allow;
  }

  request(contents: PermissionSender, permission: string, details: RequestPermissionDetails | null): boolean {
    return this.decide(this.observeRequest(contents, permission, details)).allow;
  }

  /** The single decision both handlers use. Public so a test can prove the shared path. */
  decide(facts: PermissionFacts): VoicePermissionDecision {
    const trusted = this.trustedFacts();
    if (!trusted) return deny("missing-trusted-window");
    if (facts.senderContentsId === null || facts.senderContentsId !== trusted.contentsId) return deny("untrusted-sender");
    if (facts.senderWindowId === null || facts.senderWindowId !== trusted.windowId) return deny("untrusted-window");
    if (!facts.topLevel || facts.frameId === null || facts.frameId !== trusted.frameId) return deny("untrusted-frame");
    if (facts.origin === null) return deny("missing-origin");
    if (facts.origin !== trusted.origin) return deny("untrusted-origin");
    if (facts.permission !== "media") return deny("not-media");
    if (facts.mediaTypes.length !== 1 || facts.mediaTypes[0] !== "audio") return deny("not-audio-only");

    const handsFree = this.registry.permits({
      senderWindowId: facts.senderWindowId,
      senderHostId: trusted.hostId,
      frameId: facts.frameId,
      topLevel: facts.topLevel,
      origin: facts.origin,
      permission: facts.permission,
      mediaTypes: facts.mediaTypes
    });
    return {
      allow: true,
      handsFree,
      reason: handsFree ? "hands-free" : "push-to-talk"
    };
  }

  registerHandsFreeGrant(grant: AudioGrant): boolean {
    return this.registry.register(grant);
  }

  replaceHandsFreeGrant(grant: AudioGrant): boolean {
    return this.registry.replace(grant);
  }

  revokeHandsFreeGrant(grantId: string): boolean {
    return this.registry.revoke(grantId);
  }

  clearHandsFreeGrants(): void {
    this.registry.clear();
  }

  activeHandsFreeGrant(): AudioGrant | null {
    return this.registry.active();
  }

  /** The studio window closed or was destroyed: its ephemeral grant goes with it. */
  windowClosed(windowId: string): boolean {
    return this.registry.windowClosed(windowId);
  }

  private trustedFacts(): TrustedStudio | null {
    const window = this.options.currentWindow();
    if (!window || !Number.isSafeInteger(window.id) || window.id < 0) return null;
    const contentsId = window.webContents?.id;
    if (!Number.isSafeInteger(contentsId)) return null;
    const frameId = frameIdentity(window.webContents);
    const origin = this.options.trustedOrigin;
    if (!frameId || !origin) return null;
    return { contentsId, windowId: String(window.id), frameId, origin, hostId: this.options.hostId };
  }

  private observeCheck(
    contents: PermissionSender | null,
    permission: string,
    requestingOrigin: string,
    details: CheckPermissionDetails | null
  ): PermissionFacts {
    const window = this.windowFor(contents);
    return {
      senderContentsId: contents?.id ?? null,
      senderWindowId: window ? String(window.id) : null,
      frameId: details?.isMainFrame === true && contents ? frameIdentity(contents) : null,
      topLevel: details?.isMainFrame === true,
      origin: originFromFacts(requestingOrigin, details?.securityOrigin),
      permission,
      mediaTypes: mediaTypesFrom(details)
    };
  }

  private observeRequest(
    contents: PermissionSender,
    permission: string,
    details: RequestPermissionDetails | null
  ): PermissionFacts {
    const window = this.windowFor(contents);
    return {
      senderContentsId: contents.id,
      senderWindowId: window ? String(window.id) : null,
      frameId: details?.isMainFrame === true ? frameIdentity(contents) : null,
      topLevel: details?.isMainFrame === true,
      origin: originFromFacts(details?.securityOrigin, details?.requestingUrl),
      permission,
      mediaTypes: mediaTypesFrom(details)
    };
  }

  private windowFor(contents: PermissionSender | null): PermissionWindow | null {
    if (!contents) return null;
    if (this.options.windowForContents) return this.options.windowForContents(contents);
    const current = this.options.currentWindow();
    return current && current.webContents.id === contents.id ? current : null;
  }
}

function deny(reason: VoicePermissionDenial): VoicePermissionDecision {
  return { allow: false, handsFree: false, reason };
}
