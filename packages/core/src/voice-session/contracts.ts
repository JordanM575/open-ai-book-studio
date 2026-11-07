/** Host-owned identities. These are not renderer credentials or persisted grants. */
export interface SessionToken {
  readonly sessionId: string;
  readonly generation: number;
}

export interface Route {
  readonly connectionId: string;
  readonly provider: string;
  readonly model: string;
  readonly destination: string;
  readonly voice: string | null;
  /** Increment even when a choice changes A → B → A. */
  readonly revision: number;
}

export interface Binding {
  readonly hostId: string;
  readonly windowId: string;
  readonly frameId: string;
  readonly origin: string;
  readonly libraryId: string;
  readonly bookId: string;
  readonly chapterId: string;
  readonly threadId: string;
  readonly mode: "discuss" | "edit";
  readonly scopeRevision: number;
  readonly sourceDigest: string;
  readonly stt: Route;
  readonly tts: Route | null;
  readonly agent: Route;
}

export interface AudioGrant extends SessionToken {
  readonly grantId: string;
  readonly hostId: string;
  readonly windowId: string;
  readonly frameId: string;
  readonly origin: string;
  readonly active: boolean;
  readonly audioOnly: boolean;
  readonly expiresAt: number;
}

export type NamedActionKind = "edit" | "destructive-approval" | "undo" | "destination" | "workflow-grant";

/** A host-prepared readback. digest covers the complete immutable payload, not just its label. */
export interface NamedAction {
  readonly actionId: string;
  readonly kind: NamedActionKind;
  readonly command: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly sourceDigest: string;
  readonly digest: string;
  /** Exact recognized/pending text included in the host's payload digest/readback. */
  readonly text: string;
}

/** Projection of the current 037 question, not another question store or authorization. */
export interface QuestionBinding {
  readonly runId: string;
  readonly questionId: string;
  readonly characterId: string;
  readonly directionRevision: number;
  readonly questionRevision: number;
  readonly sourceDigest: string;
  readonly authorityRevision: number;
}

/** Construct ONLY at the trusted host boundary, from current host state on every call. */
export interface HostFacts {
  readonly now: number;
  readonly binding: Binding;
  readonly available: boolean;
  readonly visible: boolean;
  readonly unlocked: boolean;
  readonly routesReady: boolean;
  readonly fullDuplexQualified: boolean;
  readonly grant: AudioGrant | null;
  readonly action: NamedAction | null;
  readonly question: QuestionBinding | null;
  readonly workflowRevoked: boolean;
}

export function safeCounter(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function identifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 2048;
}

export function sameToken(a: SessionToken, b: SessionToken): boolean {
  return identifier(a.sessionId) && safeCounter(a.generation) &&
    a.sessionId === b.sessionId && a.generation === b.generation;
}

export function sameRoute(a: Route | null, b: Route | null): boolean {
  if (!a || !b) return a === b;
  return a.connectionId === b.connectionId && a.provider === b.provider && a.model === b.model &&
    a.destination === b.destination && a.voice === b.voice && a.revision === b.revision;
}

export function validRoute(route: Route): boolean {
  return [route.connectionId, route.provider, route.model, route.destination].every(identifier) &&
    (route.voice === null || identifier(route.voice)) && safeCounter(route.revision);
}

export function validBinding(binding: Binding): boolean {
  return [binding.hostId, binding.windowId, binding.frameId, binding.origin, binding.libraryId,
    binding.bookId, binding.chapterId, binding.threadId, binding.sourceDigest].every(identifier) &&
    (binding.mode === "discuss" || binding.mode === "edit") && safeCounter(binding.scopeRevision) &&
    validRoute(binding.stt) && validRoute(binding.agent) && (!binding.tts || validRoute(binding.tts));
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return a.hostId === b.hostId && a.windowId === b.windowId && a.frameId === b.frameId &&
    a.origin === b.origin && a.libraryId === b.libraryId && a.bookId === b.bookId &&
    a.chapterId === b.chapterId && a.threadId === b.threadId && a.mode === b.mode &&
    a.scopeRevision === b.scopeRevision && a.sourceDigest === b.sourceDigest &&
    sameRoute(a.stt, b.stt) && sameRoute(a.tts, b.tts) && sameRoute(a.agent, b.agent);
}

export function sameAction(a: NamedAction, b: NamedAction): boolean {
  return a.actionId === b.actionId && a.kind === b.kind && a.command === b.command &&
    a.targetId === b.targetId && a.targetLabel === b.targetLabel &&
    a.sourceDigest === b.sourceDigest && a.digest === b.digest && a.text === b.text;
}

export function validAction(action: NamedAction): boolean {
  return ["edit", "destructive-approval", "undo", "destination", "workflow-grant"].includes(action.kind) &&
    [action.actionId, action.command, action.targetId, action.targetLabel, action.sourceDigest,
      action.digest].every(identifier) && typeof action.text === "string" && action.text.length <= 65_536;
}

export function sameQuestion(a: QuestionBinding, b: QuestionBinding): boolean {
  return a.runId === b.runId && a.questionId === b.questionId && a.characterId === b.characterId &&
    a.directionRevision === b.directionRevision && a.questionRevision === b.questionRevision &&
    a.sourceDigest === b.sourceDigest && a.authorityRevision === b.authorityRevision;
}

export function validQuestion(q: QuestionBinding): boolean {
  return [q.runId, q.questionId, q.characterId, q.sourceDigest].every(identifier) &&
    [q.directionRevision, q.questionRevision, q.authorityRevision].every(safeCounter);
}

/** Freeze owned plain snapshots; never call on PCM, host objects or transport handles. */
export function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export function copyBinding(binding: Binding): Binding {
  return immutable({ ...binding, stt: { ...binding.stt }, tts: binding.tts ? { ...binding.tts } : null,
    agent: { ...binding.agent } });
}
