import { type AudioGrant, type Binding, identifier, safeCounter, type SessionToken, sameToken } from "./contracts";

/** Facts extracted by the host from the real permission callback, NEVER renderer claims. */
export interface PermissionObservation {
  readonly senderWindowId: string | null;
  readonly senderHostId: string | null;
  readonly frameId: string | null;
  readonly topLevel: boolean;
  readonly origin: string | null;
  readonly permission: string;
  readonly mediaTypes: readonly string[];
}

/** Kept separate to make accidentally trusting event payloads conspicuous at integration. */
export interface PermissionAuthority {
  readonly studio: Pick<Binding, "hostId" | "windowId" | "frameId" | "origin">;
  readonly token: SessionToken;
  readonly grant: AudioGrant | null;
  readonly now: number;
  readonly captureRequested: boolean;
}

export function activeAudioGrant(authority: PermissionAuthority): boolean {
  const { grant, studio, token, now } = authority;
  return authority.captureRequested && safeCounter(now) && !!grant && grant.active && grant.audioOnly &&
    identifier(grant.grantId) && identifier(token.sessionId) && safeCounter(token.generation) &&
    sameToken(grant, token) && safeCounter(grant.expiresAt) && now < grant.expiresAt &&
    [studio.hostId, studio.windowId, studio.frameId, studio.origin].every(identifier) &&
    grant.hostId === studio.hostId && grant.windowId === studio.windowId &&
    grant.frameId === studio.frameId && grant.origin === studio.origin;
}

/** A missing/ambiguous audio type is denied, including check-handler callbacks without usable facts. */
export function permitsAudio(authority: PermissionAuthority, observed: PermissionObservation): boolean {
  return activeAudioGrant(authority) && observed.topLevel && observed.permission === "media" &&
    observed.mediaTypes.length === 1 && observed.mediaTypes[0] === "audio" &&
    observed.senderHostId === authority.studio.hostId &&
    observed.senderWindowId === authority.studio.windowId && observed.frameId === authority.studio.frameId &&
    observed.origin === authority.studio.origin;
}
