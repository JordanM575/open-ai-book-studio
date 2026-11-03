import { afterEach, describe, expect, mock, test } from "bun:test";
import { ProviderService } from "../src/main/providers";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import { OPENROUTER_KEY_EXCHANGE_URL } from "@ai-book-studio/core/providers/openrouter";

/**
 * OpenRouter sign-in flow properties (spec 012 T011). A real loopback server
 * and a stubbed key exchange prove the guards with no network beyond localhost:
 * a wrong state exchanges nothing, the first callback wins so a duplicate
 * never exchanges twice, cancellation frees the flow, and a second start
 * while one waits is refused.
 */

interface FlowMocks {
  service: ProviderService;
  vault: MemoryVault;
  authUrls: string[];
  exchangeCalls: Array<{ url: string; body: unknown }>;
}

function mockFlow(): FlowMocks {
  const vault = new MemoryVault();
  const authUrls: string[] = [];
  const exchangeCalls: Array<{ url: string; body: unknown }> = [];
  const service = new ProviderService(
    vault,
    async (url: string) => {
      authUrls.push(url);
    },
    (async (url: string, init?: RequestInit) => {
      exchangeCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ key: "sk-or-synthetic-test-key" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch
  );
  return { service, vault, authUrls, exchangeCalls };
}

function callbackUrl(authUrl: string): string {
  const callback = new URL(authUrl).searchParams.get("callback_url");
  if (!callback) throw new Error("the authorize address names no callback");
  return callback;
}

function withState(base: string, state: string, code: string): string {
  const url = new URL(base);
  url.searchParams.set("state", state);
  url.searchParams.set("code", code);
  return url.toString();
}

function expectedState(authUrl: string): string {
  const state = new URL(authUrl).searchParams.get("state");
  if (!state) throw new Error("the authorize address names no state");
  return state;
}

/** The flow opens the browser after key generation and a loopback listen; wait for it. */
async function waitForBrowser(authUrls: string[], count = 1): Promise<void> {
  for (let i = 0; i < 500 && authUrls.length < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (authUrls.length < count) throw new Error("the browser was never opened for sign-in");
}

/**
 * Capture the settlement the moment a flow starts. Awaiting the raw promise
 * later would leave a rejection unobserved while the test awaits its fetch.
 */
function startFlow(service: ProviderService) {
  const completion = service.startOpenRouter().then(
    (summary) => ({ status: "fulfilled", summary }) as const,
    (error: unknown) => ({ status: "rejected", error }) as const
  );
  return { completion };
}

describe("openrouter sign-in flow", () => {
  test("a mismatched callback exchanges nothing and frees the flow", async () => {
    const { service, vault, authUrls, exchangeCalls } = mockFlow();
    const { completion } = startFlow(service);
    await waitForBrowser(authUrls);

    const refused = await fetch(withState(callbackUrl(authUrls[0] as string), "someone-elses-state", "code-1"));
    expect(refused.status).toBe(400);
    const first = await completion;
    expect(first.status).toBe("rejected");
    if (first.status !== "rejected") throw new Error("the mismatched flow must reject");
    expect((first.error as Error).message).toContain("did not match");
    expect(exchangeCalls).toHaveLength(0);
    expect(await vault.list()).toHaveLength(0);

    // The closed flow starts cleanly again.
    const retrying = startFlow(service);
    await waitForBrowser(authUrls, 2);
    const accepted = await fetch(
      withState(callbackUrl(authUrls[1] as string), expectedState(authUrls[1] as string), "code-2")
    );
    expect(accepted.status).toBe(200);
    const retry = await retrying.completion;
    expect(retry.status).toBe("fulfilled");
    if (retry.status !== "fulfilled") throw new Error("the retry must succeed");
    expect(retry.summary.kind).toBe("openrouter-oauth");
    expect(exchangeCalls).toHaveLength(1);
    expect(await vault.list()).toHaveLength(1);
  });

  test("the first callback wins and a duplicate never exchanges twice", async () => {
    const { service, vault, authUrls, exchangeCalls } = mockFlow();
    const { completion } = startFlow(service);
    await waitForBrowser(authUrls);
    const target = withState(callbackUrl(authUrls[0] as string), expectedState(authUrls[0] as string), "code-1");

    const first = await fetch(target);
    expect(first.status).toBe(200);
    const done = await completion;
    expect(done.status).toBe("fulfilled");
    if (done.status !== "fulfilled") throw new Error("the first callback must win");
    expect(done.summary.provider).toBe("openrouter");

    // The server closed with the first exchange; the duplicate never connects.
    await expect(fetch(target)).rejects.toThrow();
    expect(exchangeCalls).toHaveLength(1);
    expect((await vault.list()).filter((connection) => connection.provider === "openrouter")).toHaveLength(1);
  });

  test("cancellation rejects the wait, exchanges nothing and frees the flow", async () => {
    const { service, vault, authUrls, exchangeCalls } = mockFlow();
    const { completion } = startFlow(service);
    await waitForBrowser(authUrls);

    service.cancelOpenRouter();
    const cancelled = await completion;
    expect(cancelled.status).toBe("rejected");
    if (cancelled.status !== "rejected") throw new Error("cancellation must reject the wait");
    expect((cancelled.error as Error).message).toContain("Sign-in cancelled.");
    expect(exchangeCalls).toHaveLength(0);
    expect(await vault.list()).toHaveLength(0);

    // The cancelled server released its flow; a fresh start works.
    const retrying = startFlow(service);
    await waitForBrowser(authUrls, 2);
    service.cancelOpenRouter();
    const retried = await retrying.completion;
    expect(retried.status).toBe("rejected");
  });

  test("a second start while one waits is refused", async () => {
    const { service, authUrls } = mockFlow();
    const { completion } = startFlow(service);
    await waitForBrowser(authUrls);
    const second = startFlow(service);
    const refused = await second.completion;
    expect(refused.status).toBe("rejected");
    if (refused.status !== "rejected") throw new Error("the second start must be refused");
    expect((refused.error as Error).message).toContain("already waiting");
    service.cancelOpenRouter();
    const cancelled = await completion;
    expect(cancelled.status).toBe("rejected");
  });

  test("the exchange posts the code with the S256 verifier to OpenRouter only", async () => {
    const { service, authUrls, exchangeCalls } = mockFlow();
    const { completion } = startFlow(service);
    await waitForBrowser(authUrls);
    const first = new URL(authUrls[0] as string).searchParams.get("state") as string;
    await fetch(withState(callbackUrl(authUrls[0] as string), first, "code-9"));
    const done = await completion;
    expect(done.status).toBe("fulfilled");
    expect(exchangeCalls).toHaveLength(1);
    expect(exchangeCalls[0]?.url).toBe(OPENROUTER_KEY_EXCHANGE_URL);
    const body = exchangeCalls[0]?.body as Record<string, unknown>;
    expect(body.code).toBe("code-9");
    expect(typeof body.code_verifier).toBe("string");
    expect((body.code_verifier as string).length).toBeGreaterThanOrEqual(43);
    expect(body.code_challenge_method).toBe("S256");
  });
});

afterEach(() => {
  mock.restore();
});
