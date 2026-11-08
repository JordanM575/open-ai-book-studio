import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { sameToken, type SessionToken } from "../../../core/src/voice-session";
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
let captureSequence = 0;
function closeCapture(owner: CaptureOwner, retry = false): Promise<HandsFreeHostOutcome> {
  if (retry && owner.closeResult && !owner.closeResult.ok) {
    delete owner.closing;
    delete owner.closeResult;
  }
  if (owner.closing) return owner.closing;
  if (owner.closed) return Promise.resolve({ ok: true });
  owner.closing = (async () => {
    const acquired = await owner.acquisition;
    if (!acquired.ok) {
      owner.closed = true;
      return { ok: true };
    }
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
  const aborts = new Map<number, AbortController>();
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

  const context = () => ({ epoch: dispatchEpoch, scope: getScope(), port: getOptions().port, signal: lifetime.signal });
  type Context = ReturnType<typeof context>;
  const current = (origin: Context) => open && origin.epoch === dispatchEpoch &&
    origin.port === getOptions().port && sameScope(origin.scope, getScope());

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const readFacts = async (origin: Context): Promise<HandsFreeFacts | null> => {
    const port = origin.port;
    if (!port) return null;
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
      if (!snapshot) return null;
      return { ...snapshot, now: port.now ? port.now() : Date.now() };
    } catch {
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
        try { resolve(await port.startCapture(effect.token)); }
        catch { resolve({ ok: false, reason: "Capture could not be opened." }); }
        const outcome = await acquisition;
        if (!outcome.ok) owner.closed = true;
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
        const controller = new AbortController();
        aborts.set(effect.operationId, controller);
        try {
          const facts = await readFacts(origin);
          const ready = captureClosed && current(origin) && !controller.signal.aborted && !!port?.transcribeSegment;
          dispatch({
            type: "dispatch-transcribe", requestId: effect.requestId,
            operationId: effect.operationId, chunkId: effect.chunkId,
            ready, facts: current(origin) ? facts : lastFacts, scope: getScope(),
          });
          const operation = state.transport.slots.stt;
          if (!ready || !port?.transcribeSegment || operation?.operationId !== effect.operationId ||
              operation.cancelled || operation.chunks.find((chunk) => chunk.chunkId === effect.chunkId)?.state !== "dispatched") continue;
          // No await between the exact admission above and this external boundary.
          const result = await port.transcribeSegment({
            requestId: effect.requestId,
            segmentId: effect.segmentId,
            signal: controller.signal,
          });
          // A late result is still delivered: the reducer, not this hook, decides whether it may
          // change the draft. That keeps "a late transcript cannot send after stop" in one place.
          if (result.ok) {
            await receipt({
              type: "transcript",
              text: result.text,
              operationId: effect.operationId,
              chunkId: effect.chunkId,
            });
          } else {
            await receipt({
              type: "transcript-failed",
              reason: result.reason,
              operationId: effect.operationId,
              chunkId: effect.chunkId,
            });
          }
        } catch (error) {
          await receipt({
            type: "transcript-failed",
            reason: error instanceof Error ? error.message : "Transcription failed.",
            operationId: effect.operationId,
            chunkId: effect.chunkId,
          });
        } finally {
          aborts.delete(effect.operationId);
        }
        continue;
      }
      if (effect.type === "abort-transcribe") {
        aborts.get(effect.operationId)?.abort();
        continue;
      }
      if (effect.type === "send-turn") {
        if (!current(origin)) {
          await receipt({ type: "send-settled", requestId: effect.requestId, ok: false,
            reason: "The voice session ended before dispatch. Nothing was sent." });
          continue;
        }
        let dispatched = false;
        const admission: HandsFreeAdmission = {
          async dispatch(start, viewCurrent) {
            if (dispatched || !current(origin)) return null;
            const facts = await readFacts(origin);
            if (!current(origin)) return null;
            dispatch({ type: "sync", facts, scope: origin.scope });
            if (!current(origin) || viewCurrent?.() === false ||
                !mayDispatchHandsFreeTurn(state, facts, origin.scope, effect.requestId)) return null;
            dispatched = true;
            dispatch({ type: "send-dispatched", requestId: effect.requestId, facts, scope: origin.scope });
            return start();
          },
        };
        try {
          const outcome = await getOptions().onSendTurn(effect.turn, admission);
          await receipt({
            type: "send-settled",
            ok: outcome.ok,
            requestId: effect.requestId,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          });
        } catch (error) {
          getOptions().onNotice?.(error);
          await receipt({
            type: "send-settled",
            ok: false,
            requestId: effect.requestId,
            reason: error instanceof Error ? error.message : "The turn could not be sent.",
          });
        }
      }
    }
  };

  /** The single writer. Kept synchronous so two rapid confirms see each other's state. */
  const dispatch = (event: HandsFreeEvent): void => {
    // Disposed stores still consume attributable receipts and finish owned cleanup, but never
    // acquire/send. StrictMode may later resubscribe; counters and revoked state are retained.
    lastFacts = event.facts;
    const wasActive = state.session.active;
    const next = reduceHandsFree(state, event);
    state = next.state;
    if (wasActive && !state.session.active) advanceEpoch();
    emit();
    void runEffects(next.effects, context());
  };

  const receipt = async (intent: HandsFreeIntent) => {
    if (intent.type === "send-settled") {
      dispatch({ ...intent, facts: lastFacts, scope: getScope() });
      return;
    }
    const origin = context();
    const facts = open ? await readFacts(origin) : null;
    dispatch({ ...intent, facts: current(origin) ? facts : lastFacts, scope: getScope() });
  };

  const revoke = (scope: HandsFreeScope) => {
    advanceEpoch();
    for (const controller of aborts.values()) controller.abort();
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
    revoke,
    start: () => send({ type: "start" }),
    stop: () => {
      advanceEpoch();
      for (const controller of aborts.values()) controller.abort();
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

  useLayoutEffect(() => {
    void store.observe(scope, port);
  }, [store, scope, port]);

  useLayoutEffect(() => {
    if (!port?.onSegment) return;
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
