import { describe, expect, test } from "bun:test";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderService } from "../src/main/providers";
import { VoiceService } from "../src/main/voice";

const KEY = "meta-test-key-123456";

function wav(seconds = 1): Uint8Array {
  const sampleRate = 16_000;
  const dataBytes = sampleRate * seconds * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function credential(provider: StoredCredential["provider"] = "meta"): StoredCredential {
  return {
    id: "conn_meta0000001",
    provider,
    label: "Meta",
    kind: "api-key",
    createdAt: "2026-10-26T12:00:00.000Z",
    secret: KEY,
    ...(provider === "meta" ? { metadata: { baseUrl: "https://api.meta.ai/v1" } } : {})
  };
}

function service(fetchImpl: typeof fetch, stored: StoredCredential[] = [credential()]) {
  const vault = new MemoryVault();
  for (const entry of stored) void vault.set(entry);
  const providers = new ProviderService(vault, async () => {}, (async () => {
    throw new Error("provider catalogue must not be called");
  }) as unknown as typeof fetch);
  return new VoiceService(providers, fetchImpl);
}

describe("VoiceService", () => {
  test("posts the documented Meta form and returns the transcript", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return Response.json({ transcript: " Hello there. ", audioDurationMs: 3000, turns: [] });
    }) as typeof fetch;

    const result = await service(fetchImpl).transcribe({ audio: wav() });

    expect(result).toMatchObject({
      text: "Hello there.",
      provider: "meta",
      connectionLabel: "Meta",
      model: "muse-voice-transcribe-1.0",
      durationMs: 3000
    });
    expect(captured?.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect((captured?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const form = captured?.init?.body as FormData;
    const request = JSON.parse(await (form.get("request") as Blob).text()) as Record<string, unknown>;
    expect(request).toMatchObject({ mode: "PUSH_TO_TALK", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" });
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });

  test("refuses non-WAV audio before any request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({ transcript: "never" });
    }) as unknown as typeof fetch;

    await expect(service(fetchImpl).transcribe({ audio: new TextEncoder().encode("not audio") })).rejects.toMatchObject({
      code: "invalid-request"
    });
    expect(calls).toBe(0);
  });

  test("normalizes an auth failure without leaking the key", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: `invalid key ${KEY}` }), { status: 401 })) as unknown as typeof fetch;

    await expect(service(fetchImpl).transcribe({ audio: wav() })).rejects.toMatchObject({
      code: "auth",
      message: "The provider rejected this connection. Reconnect or check the key."
    });
  });

  test("reports the connection to use when none can transcribe", async () => {
    await expect(
      service(
        (async () => {
          throw new Error("must not call");
        }) as unknown as typeof fetch,
        [credential("openai")]
      ).transcribe({ audio: wav() })
    ).rejects.toMatchObject({ code: "invalid-request", message: expect.stringMatching(/Connect Meta/i) });
  });

  test("lists only speech-capable connections", async () => {
    const connections = await service(
      (async () => {
        throw new Error("must not call");
      }) as unknown as typeof fetch,
      [credential("openai"), credential("meta")]
    ).connections();
    expect(connections.map((entry) => entry.provider)).toEqual(["meta"]);
  });

  test("refuses a connection id that is not speech-capable", async () => {
    await expect(
      service(
        (async () => {
          throw new Error("must not call");
        }) as unknown as typeof fetch
      ).transcribe({ audio: wav(), connectionId: "conn_openai00001" })
    ).rejects.toMatchObject({ code: "invalid-request" });
  });
});
