import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import { OPENROUTER_KEY_EXCHANGE_URL, OPENROUTER_MODELS_URL, PKCE_TIMEOUT_MS } from "@ai-book-studio/core/providers/openrouter";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderService } from "../src/main/providers";

const KEY = "sk-or-v1-1234567890abcdef1234567890abcdef";

class FakeCallbackServer extends EventEmitter {
  closed = false;

  listen(): this {
    queueMicrotask(() => this.emit("listening"));
    return this;
  }

  address() {
    return { address: "127.0.0.1", family: "IPv4", port: 12345 };
  }

  close(): this {
    this.closed = true;
    return this;
  }

  callback(url: string): number {
    let status = 0;
    const response = {
      writeHead: (code: number) => { status = code; },
      end: () => {}
    };
    this.emit("request", { url: new URL(url).pathname + new URL(url).search }, response);
    return status;
  }
}

function callbackUrl(authUrl: string, state?: string): string {
  const url = new URL(authUrl);
  const callback = url.searchParams.get("callback_url");
  const returnedState = state ?? url.searchParams.get("state");
  if (!callback || !returnedState) throw new Error("missing callback parameters");
  return `${callback}?code=test-code&state=${encodeURIComponent(returnedState)}`;
}

function callbackDriver(server: FakeCallbackServer) {
  return async (authUrl: string): Promise<void> => {
    server.callback(callbackUrl(authUrl));
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
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
    const server = new FakeCallbackServer();
    let exchangeBody: Record<string, string> | null = null;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input) === OPENROUTER_KEY_EXCHANGE_URL) {
        exchangeBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return Response.json({ key: KEY });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const service = new ProviderService(vault, callbackDriver(server), fetchImpl, () => server as unknown as Server);
    const summary = await service.startOpenRouter();

    expect(summary.provider).toBe("openrouter");
    expect(summary.label).toBe("OpenRouter");
    expect(summary).not.toHaveProperty("secret");
    expect((await vault.get(summary.id))?.secret === KEY).toBe(true);
    expect(exchangeBody).toMatchObject({ code: "test-code", code_challenge_method: "S256" });
    expect(exchangeBody).toHaveProperty("code_verifier");
  });

  test("rejects a callback with the wrong state and saves nothing", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    let exchanges = 0;
    const service = new ProviderService(
      vault,
      async (authUrl) => {
        expect(server.callback(callbackUrl(authUrl, "wrong"))).toBe(400);
      },
      (async () => { exchanges += 1; return Response.json({ key: KEY }); }) as unknown as typeof fetch,
      () => server as unknown as Server
    );

    await expect(service.startOpenRouter()).rejects.toThrow(/did not match/);
    expect(exchanges).toBe(0);
    expect(await vault.list()).toEqual([]);
  });

  test("cancel closes the flow without writing a connection", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    const opened = deferred<void>();
    const service = new ProviderService(vault, async () => { opened.resolve(); }, (async () => {
      throw new Error("must not exchange");
    }) as unknown as typeof fetch, () => server as unknown as Server);

    const pending = service.startOpenRouter();
    await opened.promise;
    service.cancelOpenRouter();

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(server.closed).toBe(true);
    expect(await vault.list()).toEqual([]);
  });

  test("a failed exchange surfaces the provider error and saves nothing", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    const service = new ProviderService(
      vault,
      callbackDriver(server),
      (async (input: Parameters<typeof fetch>[0]) => {
        if (String(input) === OPENROUTER_KEY_EXCHANGE_URL) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
      () => server as unknown as Server
    );

    await expect(service.startOpenRouter()).rejects.toMatchObject({ code: "unknown" });
    expect(await vault.list()).toEqual([]);
  });

  test("rejects an expired callback before exchanging it", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    let now = 1_000;
    let exchanges = 0;
    const service = new ProviderService(vault, async (authUrl) => {
      now += PKCE_TIMEOUT_MS + 1;
      expect(server.callback(callbackUrl(authUrl))).toBe(400);
    }, (async () => { exchanges += 1; return Response.json({ key: KEY }); }) as unknown as typeof fetch,
    () => server as unknown as Server, () => now);

    await expect(service.startOpenRouter()).rejects.toThrow(/expired/);
    expect(exchanges).toBe(0);
    expect(await vault.list()).toEqual([]);
  });

  test("rejects a duplicate callback and a second start while the exchange is pending", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    const exchange = deferred<Response>();
    const started = deferred<void>();
    let exchanges = 0;
    let duplicateStatus = 0;
    const service = new ProviderService(vault, async (authUrl) => {
      const url = callbackUrl(authUrl);
      expect(server.callback(url)).toBe(200);
      duplicateStatus = server.callback(url);
    }, (async () => {
      exchanges += 1;
      started.resolve();
      return exchange.promise;
    }) as unknown as typeof fetch, () => server as unknown as Server);

    const pending = service.startOpenRouter();
    await started.promise;
    const second = service.startOpenRouter();
    void second.catch(() => {});
    exchange.resolve(Response.json({ key: KEY }));
    await pending;
    await expect(second).rejects.toMatchObject({ code: "invalid-request" });
    expect(duplicateStatus).toBe(410);
    expect(exchanges).toBe(1);
    expect(await vault.list()).toHaveLength(1);
  });

  test("cancellation during setup prevents a late callback and credential write", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    let exchanges = 0;
    const service = new ProviderService(vault, callbackDriver(server), (async () => {
      exchanges += 1;
      return Response.json({ key: KEY });
    }) as unknown as typeof fetch, () => server as unknown as Server);

    const pending = service.startOpenRouter();
    service.cancelOpenRouter();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(exchanges).toBe(0);
    expect(await vault.list()).toEqual([]);
  });

  test("cancellation during the exchange ignores a late successful response", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    const exchange = deferred<Response>();
    const started = deferred<void>();
    const service = new ProviderService(vault, callbackDriver(server), (async () => {
      started.resolve();
      return exchange.promise;
    }) as unknown as typeof fetch, () => server as unknown as Server);

    const pending = service.startOpenRouter();
    void pending.catch(() => {});
    await started.promise;
    service.cancelOpenRouter();
    exchange.resolve(Response.json({ key: KEY }));

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(await vault.list()).toEqual([]);
  });

  test("an exchange response arriving after expiry cannot write a credential", async () => {
    const vault = new MemoryVault();
    const server = new FakeCallbackServer();
    const exchange = deferred<Response>();
    const started = deferred<void>();
    let now = 1_000;
    const service = new ProviderService(vault, callbackDriver(server), (async () => {
      started.resolve();
      return exchange.promise;
    }) as unknown as typeof fetch, () => server as unknown as Server, () => now);

    const pending = service.startOpenRouter();
    void pending.catch(() => {});
    await started.promise;
    now += PKCE_TIMEOUT_MS + 1;
    exchange.resolve(Response.json({ key: KEY }));

    await expect(pending).rejects.toThrow(/expired/);
    expect(await vault.list()).toEqual([]);
  });

  test("cancellation during a vault write removes the new credential before failing", async () => {
    const writing = deferred<void>();
    const resume = deferred<void>();
    class DelayedVault extends MemoryVault {
      override async set(value: StoredCredential): Promise<void> {
        writing.resolve();
        await resume.promise;
        await super.set(value);
      }
    }
    const vault = new DelayedVault();
    const server = new FakeCallbackServer();
    const service = new ProviderService(vault, callbackDriver(server),
      (async () => Response.json({ key: KEY })) as unknown as typeof fetch, () => server as unknown as Server);
    const pending = service.startOpenRouter();
    void pending.catch(() => {});
    await writing.promise;
    service.cancelOpenRouter();
    resume.resolve();

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(await vault.list()).toEqual([]);
  });

  test("a vault write that fails after storing is rolled back", async () => {
    class FailingVault extends MemoryVault {
      override async set(value: StoredCredential): Promise<void> {
        await super.set(value);
        throw new Error("synthetic vault failure");
      }
    }
    const vault = new FailingVault();
    const server = new FakeCallbackServer();
    const service = new ProviderService(vault, callbackDriver(server),
      (async () => Response.json({ key: KEY })) as unknown as typeof fetch, () => server as unknown as Server);

    await expect(service.startOpenRouter()).rejects.toThrow(/vault failure/);
    expect(await vault.list()).toEqual([]);
  });

  test("a late failure from a cancelled browser launch does not cancel the next sign-in", async () => {
    const vault = new MemoryVault();
    const firstServer = new FakeCallbackServer();
    const nextServer = new FakeCallbackServer();
    const firstOpened = deferred<void>();
    const lateLaunch = deferred<void>();
    let launches = 0;
    const service = new ProviderService(vault, async (authUrl) => {
      launches += 1;
      if (launches === 1) {
        firstOpened.resolve();
        await lateLaunch.promise;
      } else {
        nextServer.callback(callbackUrl(authUrl));
      }
    }, (async () => Response.json({ key: KEY })) as unknown as typeof fetch,
    () => (launches === 0 ? firstServer : nextServer) as unknown as Server);

    const first = service.startOpenRouter();
    void first.catch(() => {});
    await firstOpened.promise;
    service.cancelOpenRouter();
    await expect(first).rejects.toThrow(/cancelled/);
    const next = service.startOpenRouter();
    lateLaunch.reject(new Error("synthetic late launch failure"));

    await expect(next).resolves.toMatchObject({ provider: "openrouter" });
    expect(await vault.list()).toHaveLength(1);
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
    const service = new ProviderService(new MemoryVault(), async () => {}, (async () => {
      throw new Error("unexpected provider request");
    }) as unknown as typeof fetch);
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
