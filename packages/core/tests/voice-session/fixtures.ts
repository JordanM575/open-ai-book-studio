import {
  type AudioGrant, type Binding, type HostFacts, initialVoiceSession, type NamedAction,
  reduceVoiceSession, type Route, type SessionToken, type VoiceEvent, type VoiceSession,
} from "../../src/voice-session";

export const route = (model = "synthetic-stt"): Route => ({
  connectionId: "synthetic-connection", provider: "synthetic", model,
  destination: "https://synthetic.invalid/voice", voice: null, revision: 1,
});
export const binding = (): Binding => ({
  hostId: "synthetic-host", windowId: "studio-window", frameId: "trusted-main", origin: "studio://trusted",
  libraryId: "synthetic-library", bookId: "synthetic-book", chapterId: "synthetic-chapter",
  threadId: "synthetic-thread", mode: "discuss", scopeRevision: 1, sourceDigest: "synthetic-source-hash",
  stt: route(), tts: { ...route("synthetic-tts"), voice: "synthetic-voice" }, agent: route("synthetic-agent"),
});
export const token: SessionToken = { sessionId: "synthetic-session", generation: 1 };
export const grant = (t = token): AudioGrant => ({
  ...t, grantId: `synthetic-grant-${t.generation}`, hostId: "synthetic-host", windowId: "studio-window",
  frameId: "trusted-main", origin: "studio://trusted", active: true, audioOnly: true, expiresAt: 100_000,
});
export const facts = (): HostFacts => ({
  now: 1_000, binding: binding(), available: true, visible: true, unlocked: true, routesReady: true,
  fullDuplexQualified: true, grant: grant(), action: null, question: null, workflowRevoked: false,
});
export const action = (text = ""): NamedAction => ({
  actionId: "synthetic-action", kind: "edit", command: "Replace named passage", targetId: "synthetic-target",
  targetLabel: "Synthetic passage", sourceDigest: "synthetic-source-hash", digest: "synthetic-payload-hash", text,
});

export function harness(options: { autoSend?: boolean; host?: HostFacts } = {}) {
  let state = initialVoiceSession();
  let host = options.host ?? facts();
  const send = (event: VoiceEvent) => {
    const result = reduceVoiceSession(state, event, host);
    state = result.state;
    return result;
  };
  send({ type: "start", ...token, autoSendDiscuss: options.autoSend ?? false });
  send({ type: "permission", token, granted: true });
  return {
    send,
    get state(): VoiceSession { return state; },
    get host(): HostFacts { return host; },
    setHost(next: HostFacts) { host = next; },
    transcript(text: string) {
      send({ type: "segment", token, segmentId: state.lastSegment + 1 });
      const request = state.requests.stt;
      if (!request) throw new Error("Fixture failed to allocate STT.");
      return send({ type: "transcript", token, request, text });
    },
  };
}
