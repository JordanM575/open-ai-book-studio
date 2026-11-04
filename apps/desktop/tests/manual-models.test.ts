import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import { MANUAL_MODELS_KEY } from "@ai-book-studio/core/providers/manual";
import { canRunAgent, findModel } from "@ai-book-studio/core/providers/models";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import type { Studio } from "../src/main/studio";
import { AgentRuntime } from "../src/main/agent/runtime";
import { MODEL_CHECK_MAX_TOKENS, MODEL_CHECK_PROMPT } from "../src/main/agent/transport";
import { FileCredentialVault, type Cipher } from "../src/main/credential-file";
import { Library } from "../src/main/library/store";
import { ProviderService } from "../src/main/providers";

/**
 * 011 FR-007: a model id the provider does not list can be entered by hand, and is kept only after the
 * model answers one short request on the connection's own endpoint. Every request here goes to a
 * recording fetch; nothing reaches a network and no key is real.
 */

const META_BASE = "https://meta.example.test/v1";
const META_SECRET = "meta-test-secret-0001";
const OPENROUTER_SECRET = "openrouter-test-secret-0001";
const META_ID = "conn_metatest0001";
const OPENROUTER_ID = "conn_ortest000001";

const cipher: Cipher = {
  available: () => true,
  encrypt: (value) => `enc:${Buffer.from(value, "utf8").toString("base64")}`,
  decrypt: (value) => Buffer.from(value.slice(4), "base64").toString("utf8")
};

function meta(metadata: Record<string, string> = {}): StoredCredential {
  return {
    id: META_ID,
    provider: "meta",
    label: "Meta",
    kind: "api-key",
    createdAt: "2026-11-03T00:00:00.000Z",
    secret: META_SECRET,
    metadata: { baseUrl: META_BASE, ...metadata }
  };
}

function openrouter(): StoredCredential {
  return {
    id: OPENROUTER_ID,
    provider: "openrouter",
    label: "OpenRouter",
    kind: "openrouter-oauth",
    createdAt: "2026-11-03T00:00:00.000Z",
    secret: OPENROUTER_SECRET
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records every request and answers from the test's script. */
function recorder(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null
    });
    return answer(url);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** The smallest chat completion an OpenAI-compatible endpoint returns. */
function completion(): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "test",
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "length" }],
    usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
  });
}

function failing(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const noBrowser = async (): Promise<void> => {
  throw new Error("This test never opens a browser.");
};

const cleanups: string[] = [];
const deadlines = new Set<ReturnType<typeof setTimeout>>();

afterEach(async () => {
  for (const timer of deadlines) clearTimeout(timer);
  deadlines.clear();
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("checking a hand-entered model id", () => {
  test("a Meta model that answers is saved after one short request to the connection's own base URL", async () => {
    const vault = new MemoryVault();
    await vault.set(meta());
    const { calls, fetchImpl } = recorder(() => completion());
    const service = new ProviderService(vault, noBrowser, fetchImpl);

    const model = await service.addModel(META_ID, "  muse-spark-1.3  ");

    expect(model).toMatchObject({ id: "muse-spark-1.3", manual: true });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${META_BASE}/chat/completions`);
    expect(call?.method).toBe("POST");
    expect(call?.headers.authorization).toBe(`Bearer ${META_SECRET}`);
    // Minimal: the model id, a small answer limit and one fixed line. No tools, no system prompt and
    // no book text.
    expect(call?.body).toEqual({
      model: "muse-spark-1.3",
      max_tokens: MODEL_CHECK_MAX_TOKENS,
      messages: [{ role: "user", content: MODEL_CHECK_PROMPT }]
    });
    expect(MODEL_CHECK_MAX_TOKENS).toBeLessThanOrEqual(16);
    expect((await vault.get(META_ID))?.metadata).toEqual({
      baseUrl: META_BASE,
      [MANUAL_MODELS_KEY]: JSON.stringify(["muse-spark-1.3"])
    });
  });

  test("an OpenRouter model is checked at OpenRouter's own completion endpoint", async () => {
    const vault = new MemoryVault();
    await vault.set(openrouter());
    const { calls, fetchImpl } = recorder(() => completion());
    const service = new ProviderService(vault, noBrowser, fetchImpl);

    await service.addModel(OPENROUTER_ID, "vendor/unlisted-model:free");

    expect(calls.map((call) => call.url)).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${OPENROUTER_SECRET}`);
    expect(calls[0]?.body).toEqual({
      model: "vendor/unlisted-model:free",
      max_tokens: MODEL_CHECK_MAX_TOKENS,
      messages: [{ role: "user", content: MODEL_CHECK_PROMPT }]
    });
  });

  test.each([
    [
      "a 404",
      () => failing(404, { error: { message: "The model `nope` does not exist", code: "model_not_found" } }),
      "not-found",
      /does not offer a model with that id/
    ],
    [
      "a 400 that calls the id invalid",
      () => failing(400, { error: { message: "nope is not a valid model ID", code: 400 } }),
      "not-found",
      /does not offer a model with that id/
    ],
    ["a 403", () => failing(403, { error: { message: "Forbidden" } }), "permission", /does not have permission/],
    ["a 429", () => failing(429, { error: { message: "Too many requests" } }), "rate-limit", /rate limiting/],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
      "offline",
      /could not be reached/
    ]
  ] as const)("%s refuses with the mapped reason and saves nothing", async (_name, answer, code, message) => {
    const vault = new MemoryVault();
    await vault.set(meta());
    const { calls, fetchImpl } = recorder(answer);
    const service = new ProviderService(vault, noBrowser, fetchImpl);

    const error = await service.addModel(META_ID, "nope").then(
      () => null,
      (cause: unknown) => cause as { code?: string; message?: string }
    );

    expect(error).toMatchObject({ code });
    expect(error?.message ?? "").toMatch(message);
    expect(calls).toHaveLength(1);
    expect((await vault.get(META_ID))?.metadata).toEqual({ baseUrl: META_BASE });
  });

  test("a malformed id is refused before any request", async () => {
    const vault = new MemoryVault();
    await vault.set(meta());
    const { calls, fetchImpl } = recorder(() => completion());
    const service = new ProviderService(vault, noBrowser, fetchImpl);

    for (const id of ["", "   ", "two words", "vendor/../keys", "model?key=1", "model#part", "vendor/"]) {
      await expect(service.addModel(META_ID, id)).rejects.toMatchObject({ code: "invalid-request" });
    }
    expect(calls).toHaveLength(0);
  });

  test("a connection removed while its check runs stays removed", async () => {
    const vault = new MemoryVault();
    await vault.set(meta());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls, fetchImpl } = recorder(async () => {
      await held;
      return completion();
    });
    const service = new ProviderService(vault, noBrowser, fetchImpl);

    const pending = service.addModel(META_ID, "muse-spark-1.3").then(
      () => null,
      (cause: unknown) => cause
    );
    for (let wait = 0; calls.length === 0 && wait < 200; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(calls).toHaveLength(1);
    await service.remove(META_ID);
    release();

    expect(await pending).toMatchObject({ code: "auth" });
    expect(await vault.get(META_ID)).toBeNull();
    expect(await vault.list()).toEqual([]);
  });
});

describe("hand-entered models in the catalogue", () => {
  test("a checked id survives a restart and lists like a catalogue model, marked as entered by hand", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abs-manual-models-"));
    cleanups.push(dir);
    const path = join(dir, "credentials.json");
    const listing = (url: string) =>
      url.endsWith("/models") ? Response.json({ data: [{ id: "listed-model", name: "Listed model" }] }) : completion();

    const first = new FileCredentialVault(path, cipher);
    await first.set(meta());
    await new ProviderService(first, noBrowser, recorder(listing).fetchImpl).addModel(META_ID, "unlisted-model");

    // A new vault and a new service over the same file: nothing survives in memory.
    const restarted = new ProviderService(new FileCredentialVault(path, cipher), noBrowser, recorder(listing).fetchImpl);
    const catalogue = await restarted.models(META_ID);

    expect(catalogue.models.map((model) => model.id)).toEqual(["listed-model", "unlisted-model"]);
    expect(findModel(catalogue, "unlisted-model")).toEqual({
      id: "unlisted-model",
      name: "unlisted-model",
      contextLength: null,
      supportsTools: null,
      supportsImages: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      manual: true
    });
    expect(findModel(catalogue, "listed-model")?.manual).toBeUndefined();
    // The id sits in clear beside the base URL; the secret is still only ciphertext.
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("unlisted-model");
    expect(raw).not.toContain(META_SECRET);
  });

  test("a listed model keeps the provider's facts when it was also entered by hand", async () => {
    const vault = new MemoryVault();
    await vault.set(meta({ [MANUAL_MODELS_KEY]: JSON.stringify(["listed-model"]) }));
    const { fetchImpl } = recorder(() =>
      Response.json({ data: [{ id: "listed-model", name: "Listed model", context_window: 64_000 }] })
    );
    const catalogue = await new ProviderService(vault, noBrowser, fetchImpl).models(META_ID);

    expect(catalogue.models).toHaveLength(1);
    expect(catalogue.models[0]).toMatchObject({ id: "listed-model", name: "Listed model", contextLength: 64_000 });
    expect(catalogue.models[0]?.manual).toBeUndefined();
  });

  test("a connection whose list cannot be read still offers the models checked by hand", async () => {
    const vault = new MemoryVault();
    await vault.set(meta());
    const { fetchImpl } = recorder((url) => (url.endsWith("/models") ? failing(404, { error: "Not found" }) : completion()));
    const service = new ProviderService(vault, noBrowser, fetchImpl);

    // With nothing entered by hand, a list that cannot be read is still a failure.
    await expect(service.models(META_ID)).rejects.toBeDefined();

    await service.addModel(META_ID, "muse-spark-1.3");
    const catalogue = await service.models(META_ID);

    expect(catalogue.fetchedAt).toBeNull();
    expect(catalogue.listError).toBe("The provider returned an unexpected response.");
    expect(catalogue.models.map((model) => model.id)).toEqual(["muse-spark-1.3"]);
    const model = findModel(catalogue, "muse-spark-1.3");
    expect(model?.manual).toBe(true);
    // Meta's documented preset supplies the facts, so the writing agent can use the model.
    expect(model).toMatchObject({ name: "Muse Spark 1.3", supportsTools: true, contextLength: 1_048_576 });
    expect(canRunAgent(model)).toBe(true);
  });

  test("a turn on an unlisted connection runs with the model entered by hand", async () => {
    const root = await mkdtemp(join(tmpdir(), "abs-manual-turn-"));
    cleanups.push(root);
    const library = await Library.open(root);
    const book = await library.createBook({ title: "The Salt Road" });
    const vault = new MemoryVault();
    await vault.set(meta({ [MANUAL_MODELS_KEY]: JSON.stringify(["muse-spark-1.3"]) }));
    const { calls, fetchImpl } = recorder((url) => (url.endsWith("/models") ? failing(404, { error: "Not found" }) : completion()));
    const service = new ProviderService(vault, noBrowser, fetchImpl);
    const studio = { library, requireLibrary: () => library } as unknown as Studio;

    let finish!: (event: Extract<AgentEvent, { type: "done" | "error" }>) => void;
    const done = new Promise<Extract<AgentEvent, { type: "done" | "error" }>>((resolve, reject) => {
      finish = resolve;
      deadlines.add(setTimeout(() => reject(new Error("The turn did not finish.")), 5_000));
    });
    const runtime = new AgentRuntime(
      studio,
      service,
      (event) => {
        if (event.type === "done" || event.type === "error") finish(event);
      },
      () => textModel()
    );

    await runtime.start({
      mode: "edit",
      bookId: book.id,
      prompt: "Write the next line.",
      model: { connectionId: META_ID, modelId: "muse-spark-1.3" }
    });

    expect((await done).type).toBe("done");
    // The only request the studio made itself was the list; the turn went to the mock model.
    expect(calls.map((call) => call.url)).toEqual([`${META_BASE}/models`]);
  });
});

function textModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "The tide turned." },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            logprobs: undefined,
            usage: {
              inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 4, text: 4, reasoning: undefined }
            }
          }
        ]
      })
    }
  });
}
