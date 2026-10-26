import { describe, expect, test } from "bun:test";
import { capabilitiesFor } from "../src/providers/capabilities";
import { parseOpenRouterModels, modelLabel, perMillion } from "../src/providers/catalogue";
import { reportedCost } from "../src/providers/openrouter";
import { endpointFor, normalizeBaseUrl, parseProviderModels } from "../src/providers/keys";
import {
  catalogueFreshness,
  findModel,
  mergeCatalogue,
  unavailableReason,
  type Catalogue
} from "../src/providers/models";
import { PROVIDERS, PROVIDER_LIST, providerById, providerHosts } from "../src/providers/registry";
import { candidateFrom, chooseModel } from "../src/providers/selection";
import { PROVIDER_IDS, type ModelInfo, type ProviderId } from "../src/providers/types";

const MODEL: ModelInfo = {
  id: "test-model",
  name: "Test Model",
  contextLength: 128_000,
  supportsTools: true,
  supportsImages: false,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2
};

describe("provider registry", () => {
  test("has one complete entry for every provider id", () => {
    expect(PROVIDER_LIST.map((provider) => provider.id).sort()).toEqual([...PROVIDER_IDS].sort());
    for (const id of PROVIDER_IDS) {
      const provider = providerById(id);
      expect(provider.id).toBe(id);
      expect(provider.name.length).toBeGreaterThan(0);
      expect(provider.docsUrl).toMatch(/^https:\/\//);
      expect(provider.authKinds.length).toBeGreaterThan(0);
      expect(["yes", "no", "opt-in-header", "unknown"]).toContain(provider.browserAccess);
      for (const host of provider.hosts) {
        expect(host).toMatch(/^https:\/\//);
        expect(host.endsWith("/")).toBe(false);
      }
    }
  });

  test("derives a unique host list from the table", () => {
    const hosts = providerHosts();
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const provider of PROVIDER_LIST) {
      for (const host of provider.hosts) expect(hosts).toContain(host);
    }
  });
});

describe("provider endpoints", () => {
  test("keeps the secret in a header and never in the URL", () => {
    for (const provider of PROVIDER_LIST) {
      if (provider.id === "meta") continue;
      const endpoint = endpointFor(provider.id, "test-secret");
      expect(endpoint.url).not.toContain("test-secret");
      expect(endpoint.url).not.toContain("?");
      expect(Object.values(endpoint.headers).some((value) => value.includes("test-secret"))).toBe(true);
      expect(provider.hosts.some((host) => endpoint.url.startsWith(host))).toBe(true);
    }
  });

  test("uses each provider's authentication shape", () => {
    expect(endpointFor("openai", "key").headers.authorization).toBe("Bearer key");
    expect(endpointFor("anthropic", "key").headers["x-api-key"]).toBe("key");
    expect(endpointFor("anthropic", "key").headers["anthropic-version"]).toBeTruthy();
    expect(endpointFor("gemini", "key").headers["x-goog-api-key"]).toBe("key");
    expect(endpointFor("meta", "key", "https://api.meta.example/v1").url).toBe(
      "https://api.meta.example/v1/models"
    );
  });

  test("normalizes a base URL and refuses an insecure remote one", () => {
    expect(normalizeBaseUrl("https://api.meta.example/v1/", "meta")).toBe("https://api.meta.example/v1");
    expect(normalizeBaseUrl("http://localhost:8080/", "meta")).toBe("http://localhost:8080");
    expect(() => normalizeBaseUrl("http://api.meta.example/v1", "meta")).toThrow();
    expect(() => normalizeBaseUrl("", "meta")).toThrow();
    expect(() => normalizeBaseUrl("not a url", "meta")).toThrow();
    expect(() => endpointFor("meta", "key")).toThrow();
  });
});

describe("model catalogue parsers", () => {
  test("parses OpenAI, Anthropic, Gemini and compatible payloads", () => {
    expect(
      parseProviderModels("openai", {
        data: [{ id: "gpt-5", name: "GPT-5", context_window: 400_000 }]
      })
    ).toEqual([
      {
        id: "gpt-5",
        name: "GPT-5",
        contextLength: 400_000,
        supportsTools: null,
        supportsImages: null,
        inputPricePerMillion: null,
        outputPricePerMillion: null
      }
    ]);
    expect(
      parseProviderModels("anthropic", {
        data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4", input_token_limit: 200_000 }]
      })[0]
    ).toMatchObject({ id: "claude-sonnet-4", name: "Claude Sonnet 4", contextLength: 200_000 });
    expect(
      parseProviderModels("gemini", {
        models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputTokenLimit: 1_048_576 }]
      })[0]
    ).toMatchObject({ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 1_048_576 });
    expect(
      parseProviderModels("meta", { data: [{ id: "muse-spark", name: "Muse Spark" }] })[0]
    ).toMatchObject({ id: "muse-spark", name: "Muse Spark" });
  });

  test("drops malformed entries and sorts by display name", () => {
    expect(parseProviderModels("openai", null)).toEqual([]);
    expect(parseProviderModels("openai", { data: [{ name: "No id" }] })).toEqual([]);
    expect(
      parseProviderModels("openai", {
        data: [
          { id: "z", name: "Zeta" },
          { id: "a", name: "Alpha" }
        ]
      }).map((model) => model.id)
    ).toEqual(["a", "z"]);
  });

  test("parses OpenRouter capabilities and per-million prices", () => {
    const models = parseOpenRouterModels({
      data: [
        {
          id: "vendor/model-b",
          name: "Model B",
          context_length: 128_000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
          supported_parameters: ["tools", "temperature"],
          architecture: { input_modalities: ["text", "image"] }
        },
        { id: "vendor/model-a", name: "Model A" },
        { name: "missing id" }
      ]
    });
    expect(models.map((model) => model.id)).toEqual(["vendor/model-a", "vendor/model-b"]);
    expect(models[1]).toMatchObject({
      contextLength: 128_000,
      supportsTools: true,
      supportsImages: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15
    });
    expect(perMillion(-1)).toBeNull();
    expect(perMillion("not a price")).toBeNull();
    expect(modelLabel("openrouter", "vendor/model-a")).toBe("model a");
  });
});

describe("reported cost", () => {
  test("reads OpenRouter's final-step cost and rejects unknown values", () => {
    expect(reportedCost("openrouter", { openrouter: { usage: { cost: 0.0012 } } })).toBe(0.0012);
    expect(reportedCost("openrouter", { openrouter: { cost: "0.5" } })).toBe(0.5);
    expect(reportedCost("openrouter", { openrouter: { usage: { cost: 0 } } })).toBe(0);
    expect(reportedCost("openrouter", { openrouter: { usage: { cost: -1 } } })).toBeNull();
    expect(reportedCost("openrouter", { openrouter: { usage: { cost: "nope" } } })).toBeNull();
    expect(reportedCost("openrouter", { openrouter: {} })).toBeNull();
    expect(reportedCost("openrouter", null)).toBeNull();
    expect(reportedCost("openai", { openrouter: { usage: { cost: 1 } } })).toBeNull();
  });
});

describe("catalogue merge and freshness", () => {
  test("keeps known values when a fresh response omits them", () => {
    const previous: Catalogue = { models: [{ ...MODEL, contextLength: 100_000 }], fetchedAt: "2026-01-01T00:00:00.000Z" };
    const merged = mergeCatalogue(
      previous,
      [{ ...MODEL, contextLength: null, supportsTools: null }],
      "2026-01-02T00:00:00.000Z"
    );
    expect(merged.fetchedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(merged.models[0]?.contextLength).toBe(100_000);
    expect(merged.models[0]?.supportsTools).toBe(true);
    expect(findModel(merged, MODEL.id)?.name).toBe(MODEL.name);
    expect(findModel(merged, "missing")).toBeNull();
  });

  test("reports fresh, stale and absent catalogues", () => {
    const at = Date.parse("2026-01-01T00:00:00.000Z");
    expect(catalogueFreshness({ models: [], fetchedAt: "2026-01-01T00:00:00.000Z" }, at)).toBe("fresh");
    expect(catalogueFreshness({ models: [], fetchedAt: "2025-12-30T00:00:00.000Z" }, at)).toBe("stale");
    expect(catalogueFreshness({ models: [], fetchedAt: null }, at)).toBe("absent");
    expect(catalogueFreshness({ models: [], fetchedAt: "not a date" }, at)).toBe("absent");
  });
});

describe("capabilities and selection", () => {
  test("never guesses a capability the provider did not report", () => {
    expect(capabilitiesFor("openrouter", MODEL)).toMatchObject({
      browser: "yes",
      canRunAgent: true,
      supportsTools: true,
      supportsImages: false,
      reasons: []
    });
    expect(capabilitiesFor("openai", null)).toMatchObject({
      browser: "no",
      canRunAgent: false,
      supportsTools: null,
      reasons: ["This model is no longer in the provider's list."]
    });
    expect(unavailableReason({ ...MODEL, supportsTools: false })).toContain("cannot use tools");
    expect(unavailableReason({ ...MODEL, supportsTools: null })).toContain("does not say");
    expect(unavailableReason({ ...MODEL, contextLength: null })).toContain("context size");
  });

  test("prefers a turn choice, then the book, then the first usable model", () => {
    const candidates = [
      candidateFrom({ provider: "openai", connectionId: "conn_a", modelId: "a" }, { ...MODEL, id: "a" }, "A"),
      candidateFrom({ provider: "anthropic", connectionId: "conn_b", modelId: "b" }, null, "B")
    ];
    expect(
      chooseModel({
        turn: { provider: "openai", connectionId: "conn_a", modelId: "a" },
        book: { provider: "anthropic", connectionId: "conn_b", modelId: "b" },
        candidates
      })
    ).toMatchObject({ source: "turn", choice: { modelId: "a" } });
    expect(
      chooseModel({
        book: { provider: "anthropic", connectionId: "conn_b", modelId: "b" },
        candidates
      })
    ).toMatchObject({ source: "first", choice: { modelId: "a" } });
    expect(chooseModel({ candidates: [candidates[1]!] })).toMatchObject({
      source: "none",
      choice: null,
      reason: "No connected model can run the writing agent yet."
    });
  });
});
