import { describe, expect, test } from "bun:test";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import { OPENROUTER_KEY_EXCHANGE_URL, OPENROUTER_MODELS_URL } from "@ai-book-studio/core/providers/openrouter";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderService } from "../src/main/providers";

const KEY = "sk-or-v1-1234567890abcdef1234567890abcdef";

function callbackDriver() {
  return async (authUrl: string): Promise<void> => {
    const url = new URL(authUrl);
    const callback = url.searchParams.get("callback_url");
    const state = url.searchParams.get("state");
    if (!callback || !state) throw new Error("missing callback parameters");
    await fetch(`${callback}?code=test-code&state=${encodeURIComponent(state)}`);
  };
}

function credential(): StoredCredential {
  return {
    id: "conn_test00000001",
    provider: "openrouter",
    label: "OpenRouter",
    kind: "openrouter-oauth",
    createdAt: "2026-10-24T10:00:00.000Z",
    secret: KEY
  };
}

describe("OpenRouter connection flow", () => {
  test("stores a connection and returns only a summary", async () => {
    const vault = new MemoryVault();
    let exchangeBody: Record<string, string> | null = null;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input) === OPENROUTER_KEY_EXCHANGE_URL) {
        exchangeBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return Response.json({ key: KEY });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const service = new ProviderService(vault, callbackDriver(), fetchImpl);
    const summary = await service.startOpenRouter();

    expect(summary.provider).toBe("openrouter");
    expect(summary.label).toBe("OpenRouter");
    expect(summary).not.toHaveProperty("secret");
    expect((await vault.get(summary.id))?.secret).toBe(KEY);
    expect(exchangeBody).toMatchObject({ code: "test-code", code_challenge_method: "S256" });
    expect(exchangeBody).toHaveProperty("code_verifier");
  });

  test("rejects a callback with the wrong state and saves nothing", async () => {
    const vault = new MemoryVault();
    const service = new ProviderService(
      vault,
      async (authUrl) => {
        const url = new URL(authUrl);
        await fetch(`${url.searchParams.get("callback_url")}?code=test-code&state=wrong`);
      },
      (async () => Response.json({ key: KEY })) as unknown as typeof fetch
    );

    await expect(service.startOpenRouter()).rejects.toThrow(/did not match/);
    expect(await vault.list()).toEqual([]);
  });

  test("cancel closes the flow without writing a connection", async () => {
    const vault = new MemoryVault();
    const service = new ProviderService(vault, async () => {}, (async () => {
      throw new Error("must not exchange");
    }) as unknown as typeof fetch);

    const pending = service.startOpenRouter();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await service.cancelOpenRouter();

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(await vault.list()).toEqual([]);
  });

  test("a failed exchange surfaces the provider error and saves nothing", async () => {
    const vault = new MemoryVault();
    const service = new ProviderService(
      vault,
      callbackDriver(),
      (async (input: Parameters<typeof fetch>[0]) => {
        if (String(input) === OPENROUTER_KEY_EXCHANGE_URL) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch
    );

    await expect(service.startOpenRouter()).rejects.toMatchObject({ code: "unknown" });
    expect(await vault.list()).toEqual([]);
  });

  test("lists models, keeps a cache and reports prices per million", async () => {
    const vault = new MemoryVault();
    await vault.set(credential());
    let calls = 0;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      if (String(input) === OPENROUTER_MODELS_URL) {
        calls += 1;
        return Response.json({
          data: [
            {
              id: "test/model",
              name: "Test Model",
              context_length: 128000,
              supported_parameters: ["tools"],
              architecture: { input_modalities: ["text", "image"] },
              pricing: { prompt: "0.000003", completion: "0.000015" }
            }
          ]
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const service = new ProviderService(vault, async () => {}, fetchImpl);
    const catalogue = await service.models("conn_test00000001");
    expect(catalogue.models[0]).toMatchObject({
      id: "test/model",
      contextLength: 128000,
      supportsTools: true,
      supportsImages: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15
    });
    await service.models("conn_test00000001");
    expect(calls).toBe(1);
  });

  test("testing an unknown connection says to connect again", async () => {
    const service = new ProviderService(new MemoryVault(), async () => {}, fetch as typeof fetch);
    await expect(service.test("conn_missing000001")).rejects.toThrow(/no longer exists/);
  });
});

describe("API key connections", () => {
  test("validates a key with the provider before storing it", async () => {
    const vault = new MemoryVault();
    let authorization = "";
    const service = new ProviderService(
      vault,
      async () => {},
      (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
        return Response.json({ data: [{ id: "gpt-test" }] });
      }) as typeof fetch
    );

    const summary = await service.addKey({ provider: "openai", secret: "sk-test-1234567890" });
    expect(authorization).toBe("Bearer sk-test-1234567890");
    expect(summary.label).toBe("OpenAI");
    expect(summary).not.toHaveProperty("secret");
    expect((await vault.get(summary.id))?.secret).toBe("sk-test-1234567890");
  });

  test("a rejected key is reported and never saved", async () => {
    const vault = new MemoryVault();
    const service = new ProviderService(
      vault,
      async () => {},
      (async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 })) as unknown as typeof fetch
    );

    await expect(service.addKey({ provider: "openai", secret: "sk-test-1234567890" })).rejects.toMatchObject({
      code: "auth"
    });
    expect(await vault.list()).toEqual([]);
  });

  test("a rate-limited key is reported with its own reason and not saved", async () => {
    const vault = new MemoryVault();
    const service = new ProviderService(
      vault,
      async () => {},
      (async () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch
    );

    await expect(service.addKey({ provider: "gemini", secret: "AIza-test-1234567890" })).rejects.toMatchObject({
      code: "rate-limit",
      options: { retryAfterSeconds: 30 }
    });
    expect(await vault.list()).toEqual([]);
  });

  test("an unreachable provider is offline, not an invalid key", async () => {
    const vault = new MemoryVault();
    const service = new ProviderService(
      vault,
      async () => {},
      (async () => {
        throw new Error("fetch failed");
      }) as unknown as typeof fetch
    );

    await expect(service.addKey({ provider: "anthropic", secret: "sk-ant-test-1234567890" })).rejects.toMatchObject({
      code: "offline"
    });
    expect(await vault.list()).toEqual([]);
  });

  test("Meta needs a base URL before anything is sent", async () => {
    const vault = new MemoryVault();
    let called = false;
    const service = new ProviderService(
      vault,
      async () => {},
      (async () => {
        called = true;
        return Response.json({});
      }) as unknown as typeof fetch
    );

    await expect(service.addKey({ provider: "meta", secret: "meta-test-123456" })).rejects.toMatchObject({
      code: "invalid-request"
    });
    expect(called).toBe(false);
    expect(await vault.list()).toEqual([]);
  });

  test("lists models from an OpenAI-key connection and caches them", async () => {
    const vault = new MemoryVault();
    await vault.set({
      id: "conn_openai000001",
      provider: "openai",
      label: "OpenAI",
      kind: "api-key",
      createdAt: "2026-10-24T10:00:00.000Z",
      secret: "sk-test-1234567890"
    });
    let calls = 0;
    const service = new ProviderService(
      vault,
      async () => {},
      (async (input: Parameters<typeof fetch>[0]) => {
        if (String(input) === "https://api.openai.com/v1/models") {
          calls += 1;
          return Response.json({ data: [{ id: "gpt-test", name: "GPT Test" }] });
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch
    );

    const catalogue = await service.models("conn_openai000001");
    expect(catalogue.models[0]).toMatchObject({ id: "gpt-test", name: "GPT Test", supportsTools: null });
    await service.models("conn_openai000001");
    expect(calls).toBe(1);
  });

  test("Anthropic is tested with its own headers, never a query key", async () => {
    const vault = new MemoryVault();
    await vault.set({
      id: "conn_anthro000001",
      provider: "anthropic",
      label: "Anthropic",
      kind: "api-key",
      createdAt: "2026-10-24T10:00:00.000Z",
      secret: "sk-ant-test-1234567890"
    });
    const seen: { url: string; headers: Record<string, string> } = { url: "", headers: {} };
    const service = new ProviderService(
      vault,
      async () => {},
      (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        seen.url = String(input);
        seen.headers = (init?.headers as Record<string, string>) ?? {};
        return Response.json({ data: [] });
      }) as typeof fetch
    );

    const result = await service.test("conn_anthro000001");
    expect(result.message).toContain("Anthropic accepted");
    expect(seen.url).not.toContain("key=");
    expect(seen.headers["x-api-key"]).toBe("sk-ant-test-1234567890");
    expect(seen.headers["anthropic-version"]).toBeTruthy();
  });
});

describe("credential status", () => {
  test("reports the backend and connection count without a secret", async () => {
    const vault = new MemoryVault();
    await vault.set(credential());
    const service = new ProviderService(vault, async () => {}, (async () => {
      throw new Error("must not call");
    }) as unknown as typeof fetch);
    const status = await service.status();
    expect(status).toMatchObject({ available: true, backend: "In-memory test vault", connections: 1 });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });
});
