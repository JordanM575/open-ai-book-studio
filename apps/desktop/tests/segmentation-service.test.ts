import { describe, expect, test } from "bun:test";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderService } from "../src/main/providers";
import { SegmentationService, outputText } from "../src/main/segmentation";

const KEY = "meta-sam-key-123456";

function credential(): StoredCredential {
  return {
    id: "conn_meta0000001",
    provider: "meta",
    label: "Meta",
    kind: "api-key",
    createdAt: "2026-10-26T12:00:00.000Z",
    secret: KEY,
    metadata: { baseUrl: "https://api.meta.ai/v1" }
  };
}

function service(fetchImpl: typeof fetch, stored: StoredCredential[] = [credential()]) {
  const vault = new MemoryVault();
  for (const entry of stored) void vault.set(entry);
  const providers = new ProviderService(vault, async () => {}, (async () => {
    throw new Error("catalogue must not be called");
  }) as unknown as typeof fetch);
  return new SegmentationService(providers, fetchImpl);
}

const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  )
);

describe("SegmentationService", () => {
  test("sends the SAM request with a data URL and returns zero matches", async () => {
    const captured: { url?: string; init?: RequestInit | undefined } = {};
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return Response.json({
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] }]
      });
    }) as typeof fetch;

    const result = await service(fetchImpl).segment({
      prompt: "red hat",
      bytes: PNG,
      mimeType: "image/png"
    });

    expect(result).toEqual({ prompt: "red hat", model: "sam-3.1", matches: [], costUsd: null });
    expect(captured.url).toBe("https://api.meta.ai/v1/responses");
    expect((captured.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(captured.init?.body)) as Record<string, any>;
    expect(body).toMatchObject({
      model: "sam-3.1",
      stream: false,
      metadata: { mask_encoding: "one_bit", include_confidence: "true" }
    });
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "red hat" });
    expect(body.input[0].content[1].image_url).toEqual(expect.stringMatching(/^data:image\/png;base64,/));
  });

  test("refuses commands, lists and negation before any request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({});
    }) as unknown as typeof fetch;
    for (const prompt of ["find the hat", "red hat or blue hat", "a person without a hat", "where is the hat?"]) {
      await expect(service(fetchImpl).segment({ prompt, bytes: PNG, mimeType: "image/png" })).rejects.toMatchObject({
        code: "invalid-request"
      });
    }
    expect(calls).toBe(0);
  });

  test("normalizes auth and provider failures", async () => {
    const auth = (async () => new Response("invalid key", { status: 401 })) as unknown as typeof fetch;
    await expect(service(auth).segment({ prompt: "red hat", bytes: PNG, mimeType: "image/png" })).rejects.toMatchObject({
      code: "auth"
    });
  });

  test("requires a Meta connection", async () => {
    await expect(
      service(
        (async () => {
          throw new Error("must not call");
        }) as unknown as typeof fetch,
        []
      ).segment({ prompt: "red hat", bytes: PNG, mimeType: "image/png" })
    ).rejects.toMatchObject({ code: "invalid-request", message: expect.stringMatching(/Connect Meta/i) });
  });

  test("reads output_text from a non-streaming response", () => {
    expect(
      outputText({
        output: [
          { type: "reasoning", content: [] },
          { type: "message", content: [{ type: "output_text", text: "segment text" }] }
        ]
      })
    ).toBe("segment text");
    expect(outputText({ output: [] })).toBeNull();
  });
});
