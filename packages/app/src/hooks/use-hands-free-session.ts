import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  handsFreePhase,
  initialHandsFreeState,
  reduceHandsFree,
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
  readonly onSendTurn: (turn: HandsFreeTurn) => Promise<{ ok: boolean; reason?: string }>;
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
  observe(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  confirm(): Promise<void>;
  correct(text: string): Promise<void>;
  discard(): Promise<void>;
  continueSession(): Promise<void>;
  acknowledge(): Promise<void>;
  segment(segmentId: number): Promise<void>;
  dispose(): void;
}

function createHandsFreeStore(
  getOptions: () => Options,
  getScope: () => HandsFreeScope,
): HandsFreeStore {
  let state = initialHandsFreeState();
  const listeners = new Set<() => void>();
  const aborts = new Map<number, AbortController>();
  let confirmPending = false;
  // React StrictMode runs an effect cleanup and setup again on the same mount. A permanent
  // `disposed` flag would leave the store dead in development, so cleanup only closes it and a
  // later subscribe re-arms it. A real unmount has no subscribe, so the store stays closed.
  let open = true;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const readFacts = async (): Promise<HandsFreeFacts | null> => {
    const port = getOptions().port;
    if (!port) return null;
    try {
      const snapshot = await port.snapshot(getScope());
      if (!snapshot) return null;
      return { ...snapshot, now: port.now ? port.now() : Date.now() };
    } catch {
      return null;
    }
  };

  /** Every intent carries freshly rebuilt facts; nothing here is cached authority. */
  const send = async (intent: HandsFreeIntent): Promise<void> => {
    if (!open) return;
    const facts = await readFacts();
    if (!open) return;
    dispatch({ ...intent, facts, scope: getScope() });
  };

  const runEffects = async (effects: readonly HandsFreeEffect[]): Promise<void> => {
    // One capture close per session per batch: a Stop emits both `stop-capture` and `revoke-grant`,
    // which describe the same host action.
    const closing = new Set<string>();
    for (const effect of effects) {
      if (!open) return;
      if (effect.type === "capture-open") {
        const port = getOptions().port;
        if (!port?.startCapture) {
          await send({
            type: "capture-settled",
            open: false,
            token: effect.token,
            reason: "No capture adapter is mounted in this build, so nothing is recorded.",
          });
          continue;
        }
        try {
          const outcome = await port.startCapture(effect.token);
          await send({
            type: "capture-settled",
            open: outcome.ok,
            token: effect.token,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          });
        } catch (error) {
          getOptions().onNotice?.(error);
          await send({
            type: "capture-settled",
            open: false,
            token: effect.token,
            reason: "Capture could not be opened.",
          });
        }
        continue;
      }
      if (effect.type === "capture-close") {
        const key = `${effect.token.sessionId}:${effect.token.generation}`;
        if (closing.has(key)) continue;
        closing.add(key);
        try {
          const port = getOptions().port;
          const outcome = port?.stopCapture
            ? await port.stopCapture(effect.token)
            : { ok: false, reason: "This build has no capture host to stop." };
          await send({
            type: "stop-settled",
            ok: outcome.ok,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          });
        } catch (error) {
          getOptions().onNotice?.(error);
          await send({ type: "stop-settled", ok: false, reason: "The host did not confirm that capture closed." });
        }
        continue;
      }
      if (effect.type === "transcribe") {
        const port = getOptions().port;
        if (!port?.transcribeSegment) {
          await send({
            type: "transcript-failed",
            reason: "No transcription adapter is mounted in this build.",
            operationId: effect.operationId,
            chunkId: effect.chunkId,
          });
          continue;
        }
        const controller = new AbortController();
        aborts.set(effect.operationId, controller);
        try {
          const result = await port.transcribeSegment({
            requestId: effect.requestId,
            segmentId: effect.segmentId,
            signal: controller.signal,
          });
          // A late result is still delivered: the reducer, not this hook, decides whether it may
          // change the draft. That keeps "a late transcript cannot send after stop" in one place.
          if (result.ok) {
            await send({
              type: "transcript",
              text: result.text,
              operationId: effect.operationId,
              chunkId: effect.chunkId,
            });
          } else {
            await send({
              type: "transcript-failed",
              reason: result.reason,
              operationId: effect.operationId,
              chunkId: effect.chunkId,
            });
          }
        } catch (error) {
          await send({
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
        if (confirmPending) continue;
        confirmPending = true;
        try {
          const outcome = await getOptions().onSendTurn(effect.turn);
          await send({
            type: "send-settled",
            ok: outcome.ok,
            requestId: effect.requestId,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          });
        } catch (error) {
          getOptions().onNotice?.(error);
          await send({
            type: "send-settled",
            ok: false,
            requestId: effect.requestId,
            reason: error instanceof Error ? error.message : "The turn could not be sent.",
          });
        } finally {
          confirmPending = false;
        }
      }
    }
  };

  /** The single writer. Kept synchronous so two rapid confirms see each other's state. */
  const dispatch = (event: HandsFreeEvent): void => {
    if (!open) return;
    const next = reduceHandsFree(state, event);
    state = next.state;
    emit();
    void runEffects(next.effects);
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
    observe: () => send({ type: "sync" }),
    start: () => send({ type: "start" }),
    stop: () => send({ type: "stop" }),
    confirm: () => send({ type: "confirm" }),
    correct: (text) => send({ type: "correct", text }),
    discard: () => send({ type: "discard" }),
    continueSession: () => send({ type: "continue" }),
    acknowledge: () => send({ type: "acknowledge" }),
    segment: (segmentId) => send({ type: "segment", segmentId }),
    dispose() {
      open = false;
      // Leaving the Discuss surface must not leave capture open. This is best-effort cleanup; the
      // store is gone, so no result is presented and no retry is attempted.
      const token = state.session.token;
      const active = state.session.active;
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
      listeners.clear();
      const port = getOptions().port;
      if (active && token && port?.stopCapture) {
        void port.stopCapture(token).catch(() => undefined);
      }
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

  useEffect(() => {
    optionsRef.current = options;
    scopeRef.current = scope;
  });

  const port = options.port;

  useEffect(() => {
    // Observed immediately: a book/chapter/thread change must end the session and discard its words.
    scopeRef.current = scope;
    void store.observe();
  }, [store, scope]);

  useEffect(() => {
    if (!port?.onSegment) return;
    return port.onSegment((segment) => {
      void store.segment(segment.segmentId);
    });
  }, [port, store]);

  useEffect(() => () => store.dispose(), [store]);

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
