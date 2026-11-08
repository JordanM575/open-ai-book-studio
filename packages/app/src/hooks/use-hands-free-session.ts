import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { initialTransportLedger, reduceTransport, safeCounter, sameToken, type SessionToken,
  type TransportLedger } from "../../../core/src/voice-session";
import {
  handsFreePhase,
  initialHandsFreeState,
  reduceHandsFree,
  sameScope,
  mayOpenHandsFreeCapture,
  mayDispatchHandsFreeTurn,
  type HandsFreeAdmission,
  type HandsFreeHostOutcome,
  type HandsFreeEffect,
  type HandsFreeEvent,
  type HandsFreeFacts,
  type HandsFreeIntent,
  type HandsFreePort,
  type HandsFreeScope,
  type HandsFreeState,
  type HandsFreeTurn,
} from "../lib/hands-free";

/*
 * The React edge for the Discuss hands-free controller.
 *
 * The pure reducer owns every state transition; this hook only reads a fresh host snapshot, runs
 * the returned effect descriptions once, and feeds the real result back as an event. It starts no
 * session by itself: opening the panel, changing a chapter or focusing the bar never activates
 * capture.
 *
 * Effects this surface deliberately does not execute (no TTS or playback is mounted, and no second
 * send path exists): `new-direction` from an after-send correction, `work-control`, `stop-playback`,
 * `synthesize`, `play`, `answer-intent` and `confirmed-intent`. The reducer never presents them as
 * done; the author still confirms through the one checked Discuss turn start.
 */

export interface HandsFreeSessionScope {
  readonly bookId: string;
  readonly chapterId: string | null;
  readonly threadId: string | null;
}

export interface UseHandsFreeSessionOptions {
  readonly scope: HandsFreeSessionScope;
  readonly port?: HandsFreePort | undefined;
  /** Preserve the normal draft flush, then invoke admission.dispatch at the actual send boundary. */
  readonly onSendTurn: (turn: HandsFreeTurn, admission: HandsFreeAdmission) => Promise<{ ok: boolean; reason?: string }>;
  readonly onNotice?: ((error: unknown) => void) | undefined;
}

export interface HandsFreeSessionApi {
  readonly state: HandsFreeState;
  readonly phase: ReturnType<typeof handsFreePhase>;
  start(): void;
  stop(): void;
  confirm(): void;
  correct(text: string): void;
  discard(): void;
  continueSession(): void;
  acknowledge(): void;
}

type Options = UseHandsFreeSessionOptions;

interface HandsFreeStore {
  subscribe(listener: () => void): () => void;
  get(): HandsFreeState;
  observe(scope: HandsFreeScope, port: HandsFreePort | undefined): Promise<void>;
  watch(port: HandsFreePort | undefined): () => void;
  revoke(scope: HandsFreeScope): void;
  start(): Promise<void>;
  stop(): void;
  confirm(): Promise<void>;
  correct(text: string): void;
  discard(): Promise<void>;
  continueSession(): Promise<void>;
  acknowledge(): Promise<void>;
  segmentListener(scope: HandsFreeScope, port: HandsFreePort, token: SessionToken | null): (segmentId: number) => void;
  dispose(): void;
}

interface CaptureOwner {
  readonly id: number;
  readonly port: HandsFreePort;
  readonly token: SessionToken;
  readonly acquisition: Promise<HandsFreeHostOutcome>;
  closing?: Promise<HandsFreeHostOutcome>;
  closeResult?: HandsFreeHostOutcome;
  closed: boolean;
}

// Port ownership survives component disposal/remount and reused session tokens. A new acquisition
// cannot replace an unresolved owner, so an old compensating close can never close a newer track.
const captureOwners = new WeakMap<HandsFreePort, CaptureOwner>();
interface PortLifetime {
  ledger: TransportLedger;
  requestSequence: number;
  listeners: Set<() => void>;
}
const portLifetimes = new WeakMap<HandsFreePort, PortLifetime>();
function portLifetime(port: HandsFreePort): PortLifetime {
  let value = portLifetimes.get(port);
  if (!value) {
    value = { ledger: initialTransportLedger(), requestSequence: 0, listeners: new Set() };
    portLifetimes.set(port, value);
  }
  return value;
}
function qualified(port: HandsFreePort | undefined): port is HandsFreePort {
  return !!port && port.qualification === "synthetic-in-process-v1" &&
    typeof port.currentRevision === "function" && typeof port.onFactsChanged === "function" &&
    typeof port.admit === "function" && typeof port.snapshot === "function" &&
    typeof port.startCapture === "function" && typeof port.stopCapture === "function" &&
    typeof port.transcribeSegment === "function" && typeof port.startAgent === "function" &&
    typeof port.onSegment === "function";
}
function revision(port: HandsFreePort | undefined): number | null {
  if (!qualified(port)) return null;
  try { const value = port.currentRevision(); return safeCounter(value) ? value : null; }
  catch { return null; }
}
let captureSequence = 0;
function closeCapture(owner: CaptureOwner, retry = false): Promise<HandsFreeHostOutcome> {
  if (retry && owner.closeResult && !owner.closeResult.ok) {
    delete owner.closing;
    delete owner.closeResult;
  }
  if (owner.closing) return owner.closing;
  if (owner.closed) return Promise.resolve({ ok: true });
  owner.closing = (async () => {
    await owner.acquisition;
    // No newer owner can be installed until this one is confirmed closed.
    if (captureOwners.get(owner.port) !== owner) return { ok: false, reason: "Capture ownership changed unexpectedly." };
    try {
      const outcome = owner.port.stopCapture ? await owner.port.stopCapture(owner.token)
        : { ok: false, reason: "This build has no capture host to stop." };
      owner.closed = outcome.ok;
      return outcome;
    } catch {
      return { ok: false, reason: "The host did not confirm that capture closed." };
    }
  })().then((outcome) => { owner.closeResult = outcome; return outcome; });
  return owner.closing;
}

function createHandsFreeStore(
  getOptions: () => Options,
  getScope: () => HandsFreeScope,
): HandsFreeStore {
  let state = initialHandsFreeState();
  let lastFacts: HandsFreeFacts | null = null;
  const listeners = new Set<() => void>();
  const aborts = new Map<HandsFreePort, Map<number, AbortController>>();
  const abortAll = () => {
    for (const requests of aborts.values()) for (const controller of requests.values()) controller.abort();
  };
  // Stop invalidates queued effects synchronously, even while fresh host facts are pending.
  let dispatchEpoch = 0;
  let lifetime = new AbortController();
  const advanceEpoch = () => {
    dispatchEpoch += 1;
    lifetime.abort();
    lifetime = new AbortController();
  };
  // React StrictMode runs an effect cleanup and setup again on the same mount. A permanent
  // `disposed` flag would leave the store dead in development, so cleanup only closes it and a
  // later subscribe re-arms it. A real unmount has no subscribe, so the store stays closed.
  let open = true;
  let captureOwner: CaptureOwner | null = null;
  let watchedPort: HandsFreePort | undefined;
  let ledgerPort: HandsFreePort | undefined;
  let observedRevision: number | null = null;
  let sessionRevision: number | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  const context = () => ({ epoch: dispatchEpoch, scope: getScope(), port: getOptions().port,
    hostRevision: revision(getOptions().port), signal: lifetime.signal });
  type Context = ReturnType<typeof context>;
  const current = (origin: Context) => open && origin.epoch === dispatchEpoch &&
    origin.port === getOptions().port && sameScope(origin.scope, getScope()) &&
    (origin.port === undefined || (origin.port === watchedPort && origin.hostRevision !== null &&
      revision(origin.port) === origin.hostRevision)) &&
    (!state.session.active || sessionRevision === origin.hostRevision);

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const readFacts = async (origin: Context): Promise<HandsFreeFacts | null> => {
    const port = origin.port;
    if (!qualified(port) || origin.hostRevision === null) return null;
    try {
      if (origin.signal.aborted) return null;
      const snapshot = await new Promise<Awaited<ReturnType<HandsFreePort["snapshot"]>>>((resolve) => {
        const finish = (value: Awaited<ReturnType<HandsFreePort["snapshot"]>>) => {
          origin.signal.removeEventListener("abort", cancelled);
          resolve(value);
        };
        const cancelled = () => finish(null);
        origin.signal.addEventListener("abort", cancelled, { once: true });
        // Also normalize a synchronously throwing host without leaving an abort listener behind.
        try { void port.snapshot(origin.scope).then(finish, () => finish(null)); }
        catch { finish(null); }
      });
      if (!snapshot || snapshot.hostRevision !== origin.hostRevision || revision(port) !== origin.hostRevision) return null;
      if (!state.session.active) observedRevision = origin.hostRevision;
      return { ...snapshot, now: port.now ? port.now() : Date.now() };
    } catch {
      return null;
    }
  };

  /** The guard must call synchronously, once, at the synthetic boundary or not at all. */
  const admit = <T,>(origin: Context, kind: "capture" | "stt" | "agent", start: () => T): T | null => {
    const port = origin.port;
    if (!qualified(port) || origin.hostRevision === null || !current(origin)) return null;
    let inside = true;
    let called = false;
    let value: T | null = null;
    try {
      port.admit({ revision: origin.hostRevision, scope: origin.scope, kind }, () => {
        if (!inside || called || !current(origin)) throw new Error("Invalid synthetic admission.");
        called = true;
        value = start();
        return value;
      });
      inside = false;
      // An invoked boundary has an actual result even if a broken host reports refusal afterward.
      return called ? value : null;
    } catch (error) {
      inside = false;
      if (called && value !== null) return value;
      if (called) throw error;
      return null;
    }
  };

  /** Activation and sends require fresh host facts; a revoked pending intent cannot resume. */
  const send = async (intent: HandsFreeIntent, origin = context()): Promise<void> => {
    if (!open) return;
    if (!current(origin)) return;
    // A remount may reuse a port while the disposed owner's acquisition/close is still settling.
    // Join that ownership before admitting a new session, and retain failed cleanup visibly.
    if (intent.type === "start" && origin.port && !state.session.active) {
      const owner = captureOwners.get(origin.port);
      if (owner?.closing) await owner.closing;
    }
    const facts = await readFacts(origin);
    if (!current(origin)) return;
    if (intent.type === "start" && origin.port && !state.session.active) {
      const owner = captureOwners.get(origin.port);
      if (owner && !owner.closed && owner.closeResult && !owner.closeResult.ok) {
        captureOwner = owner;
        dispatch({ type: "capture-blocked", token: owner.token,
          reason: owner.closeResult.reason ?? "Earlier capture closure is unconfirmed.", facts, scope: origin.scope });
        return;
      }
    }
    dispatch({ ...intent, facts, scope: origin.scope });
  };

  const runEffects = async (effects: readonly HandsFreeEffect[], origin: Context): Promise<void> => {
    let captureClosed = true;
    for (const effect of effects) {
      if (effect.type === "capture-open") {
        if (!current(origin)) continue;
        const port = origin.port;
        const previous = port ? captureOwners.get(port) : undefined;
        if (previous?.closing) await previous.closing;
        const facts = await readFacts(origin);
        if (!current(origin)) continue;
        dispatch({ type: "sync", facts, scope: origin.scope });
        if (!current(origin) || !mayOpenHandsFreeCapture(state, facts, origin.scope, effect.attemptId)) continue;
        const settle = (outcome: HandsFreeHostOutcome) => dispatch({ type: "capture-settled",
          token: effect.token, attemptId: effect.attemptId, open: outcome.ok,
          ...(outcome.reason ? { reason: outcome.reason } : {}), facts, scope: origin.scope });
        if (!port?.startCapture) {
          settle({ ok: false, reason: "No capture adapter is mounted in this build, so nothing is recorded." });
          continue;
        }
        const occupied = captureOwners.get(port);
        if (occupied && !occupied.closed) {
          settle({ ok: false, reason: "Earlier capture is still owned or its closure is unconfirmed." });
          continue;
        }
        // Reserve the exact owner before crossing the external boundary. Native acquisition has
        // no cancellation handle: shutdown joins it, then closes through this original port.
        let resolve!: (outcome: HandsFreeHostOutcome) => void;
        const acquisition = new Promise<HandsFreeHostOutcome>((done) => { resolve = done; });
        const owner: CaptureOwner = { id: ++captureSequence, port, token: effect.token, acquisition, closed: false };
        captureOwners.set(port, owner);
        captureOwner = owner;
        let invoked = false;
        try {
          const pending = admit(origin, "capture", () => { invoked = true; return port.startCapture(effect.token); });
          if (!pending) {
            if (!invoked) owner.closed = true; // Only an uninvoked boundary needs no compensation.
            resolve({ ok: false, reason: "The host refused capture admission." });
          } else resolve(await pending);
        } catch { resolve({ ok: false, reason: "Capture could not be opened." }); }
        const outcome = await acquisition;
        if (!outcome.ok && invoked) {
          const cleanup = await closeCapture(owner);
          if (!cleanup.ok && current(origin)) {
            dispatch({ type: "capture-unsafe", token: effect.token,
              reason: cleanup.reason ?? "Capture closure was not confirmed.", facts, scope: origin.scope });
            continue;
          }
        }
        const latest = current(origin) ? await readFacts(origin) : null;
        if (current(origin)) dispatch({ type: "sync", facts: latest, scope: origin.scope });
        if (!current(origin) || !mayOpenHandsFreeCapture(state, latest, origin.scope, effect.attemptId)) {
          await closeCapture(owner);
        } else settle(outcome);
        continue;
      }
      if (effect.type === "capture-close") {
        const owner = captureOwner;
        const outcome = owner && sameToken(owner.token, effect.token)
          ? await closeCapture(owner, effect.purpose === "shutdown") : { ok: true };
        captureClosed = captureClosed && outcome.ok;
        // Cleanup is receipt-only: no snapshot await, epoch rebinding or permission is required.
        dispatch({ type: "stop-settled", token: effect.token, attemptId: effect.attemptId,
          purpose: effect.purpose, ok: outcome.ok, ...(outcome.reason ? { reason: outcome.reason } : {}),
          facts: lastFacts, scope: getScope() });
        continue;
      }
      if (effect.type === "transcribe") {
        const port = origin.port;
        if (!port) continue;
        const controller = new AbortController();
        let requests = aborts.get(port);
        if (!requests) { requests = new Map(); aborts.set(port, requests); }
        requests.set(effect.operationId, controller);
        try {
          const facts = await readFacts(origin);
          const ready = captureClosed && current(origin) && !controller.signal.aborted && !!port?.transcribeSegment;
          const pending = ready && port?.transcribeSegment ? admit(origin, "stt", () => {
            dispatch({ type: "dispatch-transcribe", requestId: effect.requestId,
              operationId: effect.operationId, chunkId: effect.chunkId, ready: true, facts, scope: origin.scope });
            const operation = state.transport.slots.stt;
            if (operation?.operationId !== effect.operationId || operation.cancelled ||
                operation.chunks.find((chunk) => chunk.chunkId === effect.chunkId)?.state !== "dispatched") return null;
            return port.transcribeSegment({ requestId: effect.requestId, segmentId: effect.segmentId,
              signal: controller.signal });
          }) : null;
          if (!pending) {
            if (port === getOptions().port) {
              dispatch({ type: "dispatch-transcribe", requestId: effect.requestId,
                operationId: effect.operationId, chunkId: effect.chunkId, ready: false,
                facts: current(origin) ? facts : lastFacts, scope: getScope() });
            } else {
              // A queued old-port effect cannot cancel a coincidentally equal new-port ID.
              const shared = portLifetime(port);
              shared.ledger = reduceTransport(shared.ledger, { type: "cancel", operationId: effect.operationId,
                reason: "The capture host changed before dispatch." }).ledger;
              for (const listener of shared.listeners) listener();
            }
            continue;
          }
          const result = await pending;
          // A late result is still delivered: the reducer, not this hook, decides whether it may
          // change the draft. That keeps "a late transcript cannot send after stop" in one place.
          if (result.ok) {
            await receipt({
              type: "transcript",
              text: result.text,
              operationId: effect.operationId,
              chunkId: effect.chunkId,
            }, origin);
          } else {
            await receipt({
              type: "transcript-failed",
              reason: result.reason,
              operationId: effect.operationId,
              chunkId: effect.chunkId,
            }, origin);
          }
        } catch (error) {
          await receipt({
            type: "transcript-failed",
            reason: error instanceof Error ? error.message : "Transcription failed.",
            operationId: effect.operationId,
            chunkId: effect.chunkId,
          }, origin);
        } finally {
          if (requests.get(effect.operationId) === controller) requests.delete(effect.operationId);
          if (!requests.size) aborts.delete(port);
        }
        continue;
      }
      if (effect.type === "abort-transcribe") {
        if (origin.port) aborts.get(origin.port)?.get(effect.operationId)?.abort();
        continue;
      }
      if (effect.type === "send-turn") {
        if (!current(origin)) {
          await receipt({ type: "send-settled", requestId: effect.requestId, ok: false,
            reason: "The voice session ended before dispatch. Nothing was sent." }, origin);
          continue;
        }
        let dispatched = false;
        const admission: HandsFreeAdmission = {
          async dispatch(request, viewCurrent, onDispatched) {
            if (dispatched || !current(origin)) return null;
            const facts = await readFacts(origin);
            if (!current(origin)) return null;
            dispatch({ type: "sync", facts, scope: origin.scope });
            if (!current(origin) || viewCurrent?.() === false ||
                !mayDispatchHandsFreeTurn(state, facts, origin.scope, effect.requestId)) return null;
            const port = origin.port;
            if (!port?.startAgent) return null;
            return admit(origin, "agent", () => {
              if (viewCurrent?.() === false || !mayDispatchHandsFreeTurn(state, facts, origin.scope, effect.requestId)) return null;
              dispatched = true;
              dispatch({ type: "send-dispatched", requestId: effect.requestId, facts, scope: origin.scope });
              onDispatched?.();
              return port.startAgent(request);
            });
          },
        };
        try {
          const outcome = await getOptions().onSendTurn(effect.turn, admission);
          await receipt({
            type: "send-settled",
            ok: outcome.ok && dispatched,
            requestId: effect.requestId,
            ...(!dispatched ? { reason: "The host did not dispatch this voice turn. Nothing was sent." }
              : outcome.reason ? { reason: outcome.reason } : {}),
          }, origin);
        } catch (error) {
          getOptions().onNotice?.(error);
          await receipt({
            type: "send-settled",
            ok: false,
            requestId: effect.requestId,
            reason: error instanceof Error ? error.message : "The turn could not be sent.",
          }, origin);
        }
      }
    }
  };

  /** The single writer. Kept synchronous so two rapid confirms see each other's state. */
  const dispatch = (event: HandsFreeEvent): void => {
    // Disposed stores still consume attributable receipts and finish owned cleanup, but never
    // acquire/send. StrictMode may later resubscribe; counters and revoked state are retained.
    lastFacts = event.facts;
    const port = getOptions().port;
    const shared = port ? portLifetime(port) : null;
    if (shared) state = { ...state, transport: shared.ledger,
      session: { ...state.session, sequence: Math.max(state.session.sequence, shared.requestSequence) } };
    const wasActive = state.session.active;
    const next = reduceHandsFree(state, event);
    state = next.state;
    if (!wasActive && state.session.active) sessionRevision = revision(port);
    if (wasActive && !state.session.active) sessionRevision = null;
    if (shared) {
      shared.ledger = state.transport;
      shared.requestSequence = Math.max(shared.requestSequence, state.session.sequence);
      for (const listener of shared.listeners) listener();
    }
    if (wasActive && !state.session.active) advanceEpoch();
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    const expires = event.facts?.grant?.expiresAt;
    if (state.session.active && port && expires !== undefined && event.facts) {
      const schedule = () => {
        const remaining = expires - (port.now?.() ?? Date.now());
        if (remaining <= 0) { revoke(getScope()); return; }
        expiryTimer = setTimeout(schedule, Math.min(2_147_483_647, remaining));
      };
      schedule();
    }
    emit();
    void runEffects(next.effects, context());
  };

  const revokeChangedRevision = (origin: Context) => {
    // A revision can advance before its lifecycle notice is delivered, including while this
    // receipt's snapshot is pending. End only the still-matching old session before feeding its
    // attributable settlement to the reducer; an old receipt must not revoke a newer session.
    if (open && state.session.active && origin.epoch === dispatchEpoch && origin.port &&
        origin.port === getOptions().port && sameScope(origin.scope, getScope()) &&
        sessionRevision === origin.hostRevision && revision(origin.port) !== origin.hostRevision) {
      revoke(getScope());
    }
  };

  const receipt = async (intent: HandsFreeIntent, original?: Context) => {
    const origin = original ?? context();
    if (intent.type === "send-settled") {
      revokeChangedRevision(origin);
      dispatch({ ...intent, facts: lastFacts, scope: getScope() });
      return;
    }
    const facts = current(origin) ? await readFacts(origin) : null;
    revokeChangedRevision(origin);
    if (origin.port && origin.port !== getOptions().port &&
        (intent.type === "transcript" || intent.type === "transcript-failed")) {
      const shared = portLifetime(origin.port);
      shared.ledger = reduceTransport(shared.ledger, { type: "settle", operationId: intent.operationId,
        chunkId: intent.chunkId, outcome: intent.type === "transcript" ? "success" : "failure",
        ...(intent.type === "transcript-failed" ? { failure: intent.reason } : {}) }).ledger;
      for (const listener of shared.listeners) listener();
      return;
    }
    dispatch({ ...intent, facts: current(origin) ? facts : lastFacts, scope: getScope() });
  };

  const revoke = (scope: HandsFreeScope) => {
    advanceEpoch();
    abortAll();
    dispatch({ type: "revoke", facts: lastFacts, scope });
  };

  return {
    subscribe(listener) {
      const resume = !open;
      open = true;
      listeners.add(listener);
      // Re-observe after a StrictMode cleanup, so availability and permission are fresh again.
      if (resume) void send({ type: "sync" });
      return () => {
        listeners.delete(listener);
      };
    },
    get() {
      return state;
    },
    observe: (scope, port) => send({ type: "sync" }, { ...context(), scope, port }),
    watch(port) {
      watchedPort = undefined;
      if (ledgerPort !== port) {
        state = { ...state, sttRequest: null };
        ledgerPort = port;
      }
      if (!qualified(port)) {
        observedRevision = null;
        state = { ...state, transport: initialTransportLedger(), lastReceipt: null };
        dispatch({ type: "sync", facts: null, scope: getScope() });
        return () => {};
      }
      observedRevision = revision(port);
      const shared = portLifetime(port);
      const updateLedger = () => {
        if (getOptions().port !== port || state.transport === shared.ledger) return;
        state = { ...state, transport: shared.ledger,
          lastReceipt: shared.ledger.receipts.at(-1) ?? null };
        emit();
      };
      shared.listeners.add(updateLedger);
      updateLedger();
      let active = true;
      let unsubscribe: (() => void) | undefined;
      const invalidate = () => {
        watchedPort = undefined;
        observedRevision = null;
        revoke(getScope());
        dispatch({ type: "sync", facts: null, scope: getScope() });
      };
      try {
        unsubscribe = port.onFactsChanged((notice) => {
          if (!active || getOptions().port !== port) return;
          const now = revision(port);
          if (!safeCounter(notice) || now === null || observedRevision === null || now < observedRevision || notice > now) {
            invalidate();
            return;
          }
          if (now === observedRevision) return; // An old, delayed notification cannot revoke a new session.
          observedRevision = now;
          revoke(getScope());
          void send({ type: "sync" });
        });
        if (typeof unsubscribe !== "function" || observedRevision === null) throw new Error("Invalid lifecycle subscription.");
        watchedPort = port;
        // Do not miss a change occurring while the subscription was being installed.
        const now = revision(port);
        if (now === null || now < observedRevision) throw new Error("Invalid host revision.");
        if (now !== observedRevision) {
          observedRevision = now;
          revoke(getScope());
          void send({ type: "sync" });
        }
      } catch {
        active = false;
        if (typeof unsubscribe === "function") { try { unsubscribe(); } catch {} }
        invalidate();
        return () => { shared.listeners.delete(updateLedger); };
      }
      return () => {
        active = false;
        if (watchedPort === port) watchedPort = undefined;
        try { unsubscribe?.(); } catch {} // No cleanup error can make a failed host qualified.
        shared.listeners.delete(updateLedger);
      };
    },
    revoke,
    start: () => send({ type: "start" }),
    stop: () => {
      advanceEpoch();
      abortAll();
      // Revocation must not wait for a host snapshot. Cached facts can only close work here.
      dispatch({ type: "stop", facts: lastFacts, scope: getScope() });
    },
    confirm: () => send({ type: "confirm" }),
    // Local text changes must be synchronous to preserve the controlled editor and caret.
    // This cannot send; confirm still rebuilds host facts before authorizing a turn.
    correct: (text) => dispatch({ type: "correct", text, facts: lastFacts, scope: getScope() }),
    discard: () => send({ type: "discard" }),
    continueSession: () => send({ type: "continue" }),
    acknowledge: () => send({ type: "acknowledge" }),
    segmentListener(scope, port, token) {
      const origin = { ...context(), scope, port };
      return (segmentId) => {
        if (!token || !state.session.token || !sameToken(token, state.session.token)) return;
        void send({ type: "segment", segmentId }, origin);
      };
    },
    dispose() {
      revoke(getScope());
      open = false;
      if (expiryTimer) clearTimeout(expiryTimer);
      listeners.clear();
    },
  };
}

export function useHandsFreeSession(options: UseHandsFreeSessionOptions): HandsFreeSessionApi {
  const optionsRef = useRef(options);
  const scope = useMemo<HandsFreeScope>(
    () => ({
      bookId: options.scope.bookId,
      chapterId: options.scope.chapterId,
      threadId: options.scope.threadId,
      mode: "discuss",
    }),
    [options.scope.bookId, options.scope.chapterId, options.scope.threadId],
  );
  const scopeRef = useRef(scope);

  const storeRef = useRef<HandsFreeStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createHandsFreeStore(() => optionsRef.current, () => scopeRef.current);
  }
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  useLayoutEffect(() => {
    if (optionsRef.current.port !== options.port || !sameScope(scopeRef.current, scope)) {
      store.revoke(scope);
    }
    optionsRef.current = options;
    scopeRef.current = scope;
  });

  const port = options.port;

  useLayoutEffect(() => store.watch(port), [store, port]);

  useLayoutEffect(() => {
    void store.observe(scope, port);
  }, [store, scope, port]);

  useLayoutEffect(() => {
    if (!qualified(port)) return;
    const receive = store.segmentListener(scope, port, state.session.token);
    return port.onSegment((segment) => {
      receive(segment.segmentId);
    });
  }, [port, store, scope, state.session.token]);

  useLayoutEffect(() => () => store.dispose(), [store]);

  const start = useCallback(() => void store.start(), [store]);
  const stop = useCallback(() => void store.stop(), [store]);
  const confirm = useCallback(() => void store.confirm(), [store]);
  const correct = useCallback((text: string) => void store.correct(text), [store]);
  const discard = useCallback(() => void store.discard(), [store]);
  const continueSession = useCallback(() => void store.continueSession(), [store]);
  const acknowledge = useCallback(() => void store.acknowledge(), [store]);

  return {
    state,
    phase: handsFreePhase(state),
    start,
    stop,
    confirm,
    correct,
    discard,
    continueSession,
    acknowledge,
  };
}
