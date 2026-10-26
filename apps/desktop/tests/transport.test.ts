import { describe, expect, test } from "bun:test";
import type { LanguageModel } from "ai";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderError } from "@ai-book-studio/core/providers/types";
import { modelFor, providerAdapterIds } from "../src/main/agent/transport";
import { PROVIDER_IDS } from "@ai-book-studio/core/providers/types";

function credential(provider: StoredCredential["provider"], metadata?: Record<string, string>): StoredCredential {
  return {
    id: "conn_test000001",
    provider,
    label: provider,
    kind: "api-key",
    createdAt: "2026-01-01T00:00:00.000Z",
    secret: "test-secret-value",
    ...(metadata ? { metadata } : {})
  };
}

function idOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

function providerOf(model: LanguageModel): string {
  return typeof model === "string" ? "" : model.provider;
}

describe("model transport", () => {
  test("builds a provider model without calling the network", () => {
    const model = modelFor(credential("openrouter"), "openai/gpt-5-mini");
    expect(idOf(model)).toBe("openai/gpt-5-mini");
    expect(providerOf(model)).toContain("openrouter");
  });

  test("builds native provider models", () => {
    expect(providerOf(modelFor(credential("openai"), "gpt-5-mini"))).toContain("openai");
    expect(providerOf(modelFor(credential("anthropic"), "claude-sonnet-4-5"))).toContain("anthropic");
    expect(providerOf(modelFor(credential("gemini"), "gemini-3-pro"))).toContain("google");
  });

  test("covers every provider in the registry", () => {
    expect(providerAdapterIds().sort()).toEqual([...PROVIDER_IDS].sort());
  });

  test("requires a base URL for Meta", () => {
    expect(() => modelFor(credential("meta"), "muse-1")).toThrow(ProviderError);
    const model = modelFor(credential("meta", { baseUrl: "https://api.meta.example/v1" }), "muse-1");
    expect(idOf(model)).toBe("muse-1");
  });

  test("refuses an empty model id", () => {
    expect(() => modelFor(credential("openai"), "  ")).toThrow(ProviderError);
  });
});
