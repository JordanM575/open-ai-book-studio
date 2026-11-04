import { describe, expect, test } from "bun:test";
import { MemoryVault } from "../src/providers/credentials";
import { capabilitiesFor } from "../src/providers/capabilities";
import { parseOpenRouterModels, perMillion } from "../src/providers/catalogue";
import { normalizeProviderError } from "../src/providers/errors";
import {
  authorizeUrl,
  challengeFor,
  createPkce,
  createVerifier,
  parseKeyResponse,
  readCallback
} from "../src/providers/openrouter";
import {
  canRunAgent,
  catalogueFreshness,
  mergeCatalogue,
  unavailableReason
} from "../src/providers/models";
import { PROVIDERS, PROVIDER_LIST, browserAvailabilityCopy, browserAvailable } from "../src/providers/registry";
import { connectionIdSchema, providerIdSchema } from "../src/providers/types";
import { redact, redactDeep } from "../src/providers/redact";
import {
  MUSE_SPARK_CONTRIBUTOR,
  MUSE_SPARK_STANDARD,
  applyModelPreset,
  contributorWarning,
  isContributorModelId,
  modelDisplayName
} from "../src/providers/compatibility";
import type { ModelInfo, StoredCredential } from "../src/providers/types";

const model = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "test/model",
  name: "Test Model",
  contextLength: 128_000,
  supportsTools: true,
  supportsImages: false,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
  ...overrides
});

describe("provider registry", () => {
  test("rejects an unknown provider id", () => {
    expect(providerIdSchema.safeParse("not-a-provider").success).toBe(false);
    expect(providerIdSchema.safeParse("openai").success).toBe(true);
  });

  test("rejects a malformed connection id", () => {
    expect(connectionIdSchema.safeParse("conn_abc").success).toBe(false);
    expect(connectionIdSchema.safeParse("connection_123456").success).toBe(false);
    expect(connectionIdSchema.safeParse("conn_ABCDEF").success).toBe(true);
  });

  test("every declared provider is present and unique", () => {
    expect(PROVIDER_LIST).toHaveLength(5);
    expect(new Set(PROVIDER_LIST.map((provider) => provider.id)).size).toBe(5);
    for (const provider of PROVIDER_LIST) {
      expect(provider.name.length).toBeGreaterThan(0);
      expect(provider.authKinds.length).toBeGreaterThan(0);
    }
  });

  test("browser availability is a gate, not a guess", () => {
    expect(browserAvailable("yes")).toBe(true);
    expect(browserAvailable("unknown")).toBe(false);
    expect(browserAvailable("no")).toBe(false);
    expect(PROVIDERS.openrouter.browserAccess).toBe("yes");
    expect(PROVIDERS.openai.browserAccess).toBe("no");
    expect(browserAvailabilityCopy("unknown")).toContain("Not verified");
  });

  test("no two providers claim the same host", () => {
    const hosts = PROVIDER_LIST.flatMap((provider) => provider.hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

describe("catalogue", () => {
  test("freshness distinguishes fresh, stale and absent", () => {
    const now = Date.parse("2026-10-24T12:00:00.000Z");
    expect(catalogueFreshness({ models: [], fetchedAt: null }, now)).toBe("absent");
    expect(catalogueFreshness({ models: [], fetchedAt: "2026-10-24T11:00:00.000Z" }, now)).toBe("fresh");
    expect(catalogueFreshness({ models: [], fetchedAt: "2026-10-20T11:00:00.000Z" }, now)).toBe("stale");
    expect(catalogueFreshness({ models: [], fetchedAt: "not a date" }, now)).toBe("absent");
  });

  test("merge keeps known fields when a provider omits them", () => {
    const previous = {
      models: [model({ id: "a", contextLength: 1000, supportsTools: null })],
      fetchedAt: "2026-10-23T00:00:00.000Z"
    };
    const merged = mergeCatalogue(previous, [model({ id: "a", contextLength: null, supportsTools: true })], "2026-10-24T00:00:00.000Z");
    expect(merged.models[0]?.contextLength).toBe(1000);
    expect(merged.models[0]?.supportsTools).toBe(true);
    expect(merged.fetchedAt).toBe("2026-10-24T00:00:00.000Z");
  });

  test("agent eligibility requires tools and a known context", () => {
    expect(canRunAgent(model())).toBe(true);
    expect(canRunAgent(model({ supportsTools: false }))).toBe(false);
    expect(canRunAgent(model({ supportsTools: null }))).toBe(false);
    expect(canRunAgent(model({ contextLength: null }))).toBe(false);
    expect(unavailableReason(model())).toBeNull();
    expect(unavailableReason(null)).toContain("no longer");
  });
});

describe("provider errors", () => {
  test("maps status codes to author-facing codes", () => {
    expect(normalizeProviderError({ provider: "openai", status: 401 }).code).toBe("auth");
    expect(normalizeProviderError({ provider: "openai", status: 429 }).code).toBe("rate-limit");
    expect(normalizeProviderError({ provider: "openai", status: 402 }).code).toBe("quota");
    expect(normalizeProviderError({ provider: "openai", status: 500 }).code).toBe("unknown");
    expect(normalizeProviderError({ provider: "openai", status: 400 }).code).toBe("invalid-request");
  });

  test("a rate limit names one wait: the provider's when it gave one, otherwise shortly", () => {
    expect(normalizeProviderError({ provider: "openai", status: 429 }).message).toBe(
      "The provider is rate limiting this account. Try again shortly."
    );
    const timed = normalizeProviderError({ provider: "openai", status: 429, retryAfterSeconds: 120 });
    expect(timed.message).toBe("The provider is rate limiting this account.");
  });

  test("separates a valid key that lacks permission from a rejected key", () => {
    expect(normalizeProviderError({ provider: "openai", status: 403 }).code).toBe("permission");
    expect(
      normalizeProviderError({ provider: "gemini", body: "insufficient permissions for this model" }).code
    ).toBe("permission");
    expect(normalizeProviderError({ provider: "anthropic", body: "missing scope: images" }).code).toBe(
      "permission"
    );
    expect(normalizeProviderError({ provider: "meta", body: "forbidden" }).code).toBe("permission");
    const error = normalizeProviderError({ provider: "openai", status: 403 });
    expect(error.message).toBe(
      "This key does not have permission for that request. Check the key's scopes or plan."
    );
    // A rejected key is still auth, and refusal still wins over either.
    expect(normalizeProviderError({ provider: "openai", status: 401 }).code).toBe("auth");
    expect(normalizeProviderError({ provider: "openai", body: "invalid key" }).code).toBe("auth");
    expect(normalizeProviderError({ provider: "meta", status: 403, body: "content policy" }).code).toBe(
      "refusal"
    );
  });

  test("maps provider messages without needing a status", () => {
    expect(normalizeProviderError({ provider: "gemini", status: 400, body: "context length exceeded" }).code).toBe("context");
    expect(normalizeProviderError({ provider: "meta", status: 403, body: "content policy" }).code).toBe("refusal");
    expect(normalizeProviderError({ provider: "openrouter", message: "fetch failed" }).code).toBe("offline");
  });

  test("keeps a retry hint when the provider sends one", () => {
    const error = normalizeProviderError({ provider: "openrouter", status: 429, retryAfterSeconds: 12 });
    expect(error.options.retryAfterSeconds).toBe(12);
  });
});

describe("redaction", () => {
  test("removes keys everywhere they commonly appear", () => {
    const input = [
      "key sk-or-v1-abcdefghijklmnop",
      "openai sk-abcdefghijklmnopqrstuvwx",
      "anthropic sk-ant-abcdefghij",
      "google AIzaSyA1234567890abcdefghijklmnop",
      "Authorization: Bearer abcdefghijklmnop",
      "https://example.test/?api_key=supersecret&x=1",
      '{"apiKey":"sk-secret-value"}'
    ].join("\n");
    const output = redact(input);
    expect(output).not.toContain("sk-or-v1-abcdefghijklmnop");
    expect(output).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(output).not.toContain("sk-ant-abcdefghij");
    expect(output).not.toContain("AIzaSyA1234567890abcdefghijklmnop");
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).not.toContain("supersecret");
    expect(output).not.toContain("sk-secret-value");
  });

  test("redacts object keys that name a secret", () => {
    const output = redactDeep({ apiKey: "anything", nested: { password: "hunter2" }, note: "sk-abcdefghijklmnopqrstuvwx" });
    expect(output.apiKey).toBe("[redacted]");
    expect(output.nested.password).toBe("[redacted]");
    expect(output.note).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });
});

describe("OpenRouter PKCE", () => {
  test("verifier is RFC 7636 shaped and unique", () => {
    const first = createVerifier();
    const second = createVerifier();
    expect(first).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(first).not.toBe(second);
  });

  test("matches the RFC 7636 challenge vector", async () => {
    const challenge = await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("authorize URL carries the callback, challenge and state", async () => {
    const pkce = await createPkce();
    const url = new URL(authorizeUrl({ callbackUrl: "http://127.0.0.1:4567/callback", challenge: "abc", state: pkce.state }));
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("callback_url")).toBe("http://127.0.0.1:4567/callback");
    expect(url.searchParams.get("code_challenge")).toBe("abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(pkce.state);
  });

  test("callback validation rejects mismatches and errors", () => {
    expect(readCallback("http://127.0.0.1:1/callback?code=ok&state=s", "s").code).toBe("ok");
    expect(() => readCallback("http://127.0.0.1:1/callback?code=ok&state=other", "s")).toThrow();
    expect(() => readCallback("http://127.0.0.1:1/callback?error=access_denied&state=s", "s")).toThrow(/declined/);
    expect(() => readCallback("http://127.0.0.1:1/callback?state=s", "s")).toThrow(/code/);
    expect(() => readCallback("not a url", "s")).toThrow(/valid address/);
  });

  test("expired sign-in is rejected", () => {
    const createdAt = Date.parse("2026-10-24T10:00:00.000Z");
    expect(() => readCallback("http://127.0.0.1:1/callback?code=ok&state=s", "s", createdAt + 11 * 60 * 1000, createdAt)).toThrow(/expired/);
  });

  test("key response must contain a key", () => {
    expect(parseKeyResponse({ key: "sk-or-v1-12345678" })).toBe("sk-or-v1-12345678");
    expect(() => parseKeyResponse({})).toThrow();
    expect(() => parseKeyResponse({ key: "  " })).toThrow();
  });
});

describe("OpenRouter model parsing", () => {
  test("reads context, tools, images and price", () => {
    const models = parseOpenRouterModels({
      data: [
        {
          id: "anthropic/claude-x",
          name: "Claude X",
          context_length: 200_000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
          supported_parameters: ["tools", "temperature"],
          architecture: { input_modalities: ["text", "image"] }
        },
        { id: "plain/model" }
      ]
    });
    const claude = models.find((entry) => entry.id === "anthropic/claude-x");
    expect(claude?.contextLength).toBe(200_000);
    expect(claude?.supportsTools).toBe(true);
    expect(claude?.supportsImages).toBe(true);
    expect(claude?.inputPricePerMillion).toBeCloseTo(3, 5);
    expect(claude?.outputPricePerMillion).toBeCloseTo(15, 5);
    const plain = models.find((entry) => entry.id === "plain/model");
    expect(plain?.name).toBe("plain/model");
    expect(plain?.contextLength).toBeNull();
    expect(plain?.supportsTools).toBeNull();
  });

  test("ignores malformed payloads and prices", () => {
    expect(parseOpenRouterModels(null)).toEqual([]);
    expect(parseOpenRouterModels({ data: "nope" })).toEqual([]);
    expect(perMillion(undefined)).toBeNull();
    expect(perMillion("-1")).toBeNull();
    expect(perMillion("abc")).toBeNull();
  });
});

describe("MemoryVault", () => {
  const credential: StoredCredential = {
    id: "conn_abcdef123456",
    provider: "openrouter",
    label: "OpenRouter",
    kind: "openrouter-oauth",
    createdAt: "2026-10-24T00:00:00.000Z",
    secret: "sk-or-v1-secret-value-1234"
  };

  test("lists summaries without secrets", async () => {
    const vault = new MemoryVault();
    await vault.set(credential);
    const list = await vault.list();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(list)).not.toContain("sk-or-v1");
    expect((await vault.get(credential.id))?.secret).toBe(credential.secret);
  });

  test("touch records use without changing the secret", async () => {
    const vault = new MemoryVault();
    await vault.set(credential);
    await vault.touch(credential.id, "2026-10-25T00:00:00.000Z");
    const stored = await vault.get(credential.id);
    expect(stored?.lastUsedAt).toBe("2026-10-25T00:00:00.000Z");
    expect(stored?.secret).toBe(credential.secret);
  });

  test("remove deletes the connection", async () => {
    const vault = new MemoryVault();
    await vault.set(credential);
    await vault.remove(credential.id);
    expect(await vault.get(credential.id)).toBeNull();
    expect(await vault.list()).toEqual([]);
  });
});

describe("capabilities", () => {
  const model = {
    id: "test/model",
    name: "Test",
    contextLength: 128000,
    supportsTools: true,
    supportsImages: true,
    inputPricePerMillion: 1,
    outputPricePerMillion: 2
  };

  test("a tool-capable model can run the agent", () => {
    const capabilities = capabilitiesFor("openrouter", model);
    expect(capabilities.canRunAgent).toBe(true);
    expect(capabilities.reasons).toEqual([]);
  });

  test("a model without tools is refused with a reason", () => {
    const capabilities = capabilitiesFor("openrouter", { ...model, supportsTools: false });
    expect(capabilities.canRunAgent).toBe(false);
    expect(capabilities.reasons[0]).toMatch(/cannot use tools/);
  });

  test("an unknown capability is not guessed", () => {
    const capabilities = capabilitiesFor("gemini", { ...model, supportsTools: null, contextLength: null });
    expect(capabilities.canRunAgent).toBe(false);
    expect(capabilities.browser).toBe("unknown");
    expect(capabilities.reasons).toHaveLength(1);
  });
});

describe("older books", () => {
  test("parse without the new provider fields and gain null defaults", async () => {
    const { bookSchema } = await import("../src/schema");
    const book = bookSchema.parse({
      id: "book_old00000001",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z"
    });
    expect(book.defaultProvider).toBeNull();
    expect(book.defaultConnectionId).toBeNull();
    expect(book.defaultModelId).toBeNull();
  });
});

describe("provider compatibility and the Contributor model", () => {
  const base = (id: string): ModelInfo => ({
    id,
    name: id,
    contextLength: null,
    supportsTools: null,
    supportsImages: null,
    inputPricePerMillion: null,
    outputPricePerMillion: null
  });

  test("fills the known Muse Spark 1.3 Contributor facts", () => {
    const model = applyModelPreset("meta", base(MUSE_SPARK_CONTRIBUTOR));
    expect(model).toMatchObject({
      name: "Muse Spark 1.3 Contributor",
      contextLength: 1_048_576,
      supportsTools: true,
      supportsImages: true,
      inputPricePerMillion: 0.1,
      cachedInputPricePerMillion: 0.002,
      outputPricePerMillion: 0.2,
      trainingOnData: true
    });
    expect(model.reasoningEfforts).not.toContain("max");
    expect(isContributorModelId(MUSE_SPARK_CONTRIBUTOR)).toBe(true);
    expect(contributorWarning(model)).toMatch(/train/);
  });

  test("names a model the way the author reads it, not by its raw id", () => {
    expect(modelDisplayName(MUSE_SPARK_STANDARD)).toBe("Muse Spark 1.3");
    expect(modelDisplayName(MUSE_SPARK_CONTRIBUTOR)).toBe("Muse Spark 1.3 Contributor");
    expect(modelDisplayName("vendor/some-model")).toBe("some-model");
  });

  test("keeps Standard non-training and does not touch another provider", () => {
    const standard = applyModelPreset("meta", base(MUSE_SPARK_STANDARD));
    expect(standard).toMatchObject({ trainingOnData: false, inputPricePerMillion: 1.25 });
    expect(contributorWarning(standard)).toBeNull();
    const openai = base(MUSE_SPARK_CONTRIBUTOR);
    expect(applyModelPreset("openai", openai)).toBe(openai);
  });
});
