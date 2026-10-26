import { describe, expect, test } from "bun:test";
import type { ConnectionSummary, StoredCredential } from "@ai-book-studio/core/providers/types";
import { MAX_TTS_CHARACTERS } from "@ai-book-studio/core/providers/tts";
import { SpeechService } from "../src/main/speech";
import type { ProviderService } from "../src/main/providers";

const connection: ConnectionSummary = {
  id: "conn_openai01",
  provider: "openai",
  label: "OpenAI",
  kind: "api-key",
  createdAt: "2026-10-26T12:00:00.000Z"
};

const credential: StoredCredential = {
  id: connection.id,
  provider: "openai",
  label: connection.label,
  kind: "api-key",
  createdAt: connection.createdAt,
  secret: "sk-test"
};

function providers(entries: ConnectionSummary[] = [connection]): ProviderService {
  return {
    list: async () => entries,
    credential: async (id: string) => {
      if (id !== connection.id) throw new Error("no such connection");
      return credential;
    }
  } as unknown as ProviderService;
}

interface Seen {
  url: string;
  authorization: string | undefined;
  body: { model?: string; input?: string; voice?: string; response_format?: string; speed?: number };
}

function recorder(reply: () => Response = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? {});
    seen.push({
      url,
      authorization: headers.get("authorization") ?? undefined,
      body: JSON.parse(String(init?.body ?? "{}"))
    });
    return reply();
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("the speaking service", () => {
  test("speaks one short passage in one request", async () => {
    const { seen, fetchImpl } = recorder(
      () =>
        new Response(new Uint8Array([9, 9, 9]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" }
        })
    );
    const result = await new SpeechService(providers(), fetchImpl).speak({ text: "The door was open." });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(seen[0]?.authorization).toBe("Bearer sk-test");
    expect(seen[0]?.body).toMatchObject({ input: "The door was open.", response_format: "mp3" });
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.bytes.byteLength).toBe(3);
    expect(result.chunks).toBe(1);
  });

  test("splits a long passage and joins the audio back into one sound", async () => {
    const { seen, fetchImpl } = recorder(
      () => new Response(new Uint8Array([7, 7]), { status: 200, headers: { "content-type": "audio/mpeg" } })
    );
    const text = "The storm came in low and the lamp would not turn. ".repeat(150);
    const result = await new SpeechService(providers(), fetchImpl).speak({ text });
    expect(seen.length).toBeGreaterThan(1);
    for (const call of seen) {
      expect((call.body.input ?? "").length).toBeLessThanOrEqual(MAX_TTS_CHARACTERS);
    }
    expect(result.chunks).toBe(seen.length);
    // Two bytes per chunk, joined into one buffer.
    expect(result.bytes.byteLength).toBe(seen.length * 2);
  });

  test("passes the chosen voice and speed", async () => {
    const { seen, fetchImpl } = recorder();
    await new SpeechService(providers(), fetchImpl).speak({ text: "Hello.", voice: "onyx", speed: 0.9 });
    expect(seen[0]?.body.voice).toBe("onyx");
    expect(seen[0]?.body.speed).toBe(0.9);
  });

  test("says plainly when no voice service is connected", async () => {
    const { fetchImpl } = recorder();
    await expect(new SpeechService(providers([]), fetchImpl).speak({ text: "Hello." })).rejects.toThrow(
      /Connect a voice service/i
    );
  });

  test("refuses nothing to say", async () => {
    const { fetchImpl } = recorder();
    await expect(new SpeechService(providers(), fetchImpl).speak({ text: "   " })).rejects.toThrow(
      /nothing to say/i
    );
  });

  test("reports an empty audio reply rather than playing silence", async () => {
    const { fetchImpl } = recorder(() => new Response(new Uint8Array(), { status: 200 }));
    await expect(new SpeechService(providers(), fetchImpl).speak({ text: "Hello." })).rejects.toThrow(
      /no audio/i
    );
  });

  test("turns a refused key into a sentence the author can act on", async () => {
    const { fetchImpl } = recorder(() => new Response("unauthorized", { status: 401 }));
    await expect(new SpeechService(providers(), fetchImpl).speak({ text: "Hello." })).rejects.toMatchObject({
      code: "auth"
    });
  });

  test("turns an unreachable service into an offline sentence", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new SpeechService(providers(), fetchImpl).speak({ text: "Hello." })).rejects.toMatchObject({
      code: "offline"
    });
  });

  test("lists only the connections that can speak", async () => {
    const meta: ConnectionSummary = { ...connection, id: "conn_meta0001", provider: "meta" };
    const service = new SpeechService(providers([connection, meta]), recorder().fetchImpl);
    const speakers = await service.connections();
    expect(speakers.map((entry) => entry.provider)).toEqual(["openai"]);
  });
});
