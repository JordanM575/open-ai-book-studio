import { describe, expect, test } from "bun:test";
import { CONTRIBUTOR_WARNING, contributorWarning, isContributorModel } from "../src/providers/compatibility";
import { normalizeModelCheckError } from "../src/providers/errors";
import {
  MANUAL_MODELS_KEY,
  isManualModelId,
  manualModel,
  readManualModelIds,
  withManualModelId,
  withManualModels
} from "../src/providers/manual";
import { canRunAgent, unavailableReason } from "../src/providers/models";
import { EXTERNAL_LINKS, OPENROUTER_KEYS_PAGE_URL } from "../src/providers/links";

/** 011 FR-007: the rules for a model id the author types, and how it joins a connection's list. */

describe("hand-entered model ids", () => {
  test("accepts ids as providers spell them", () => {
    for (const id of [
      "muse-spark-1.3",
      "vendor/model-name:free",
      "claude-sonnet-4-5-20250929",
      "ft:gpt-4o-mini:org:custom:abc123",
      "models/gemini-2.5-pro",
      "~vendor/model@2026+beta"
    ]) {
      expect(isManualModelId(id)).toBe(true);
    }
  });

  test("refuses anything that could change where the request goes", () => {
    for (const id of ["", " model", "two words", "vendor/../keys", "../keys", "vendor/./model", "vendor/", "/model", "a//b", "model?key=1", "model#part", 'quote"d', `${"m".repeat(201)}`]) {
      expect(isManualModelId(id)).toBe(false);
    }
  });

  test("reads kept ids defensively and never repeats one", () => {
    expect(readManualModelIds(undefined)).toEqual([]);
    expect(readManualModelIds({ baseUrl: "https://meta.example.test/v1" })).toEqual([]);
    expect(readManualModelIds({ [MANUAL_MODELS_KEY]: "not json" })).toEqual([]);
    expect(readManualModelIds({ [MANUAL_MODELS_KEY]: JSON.stringify({ id: "x" }) })).toEqual([]);
    expect(readManualModelIds({ [MANUAL_MODELS_KEY]: JSON.stringify(["a", 7, "a", "bad id", "b"]) })).toEqual(["a", "b"]);

    const once = withManualModelId({ baseUrl: "https://meta.example.test/v1" }, "a");
    const twice = withManualModelId(once, "a");
    expect(twice).toEqual({ baseUrl: "https://meta.example.test/v1", [MANUAL_MODELS_KEY]: JSON.stringify(["a"]) });
    expect(readManualModelIds(withManualModelId(twice, "b"))).toEqual(["a", "b"]);
  });

  test("an unknown model is marked as entered by hand and claims no facts", () => {
    const model = manualModel("openrouter", "vendor/unlisted");
    expect(model).toEqual({
      id: "vendor/unlisted",
      name: "vendor/unlisted",
      contextLength: null,
      supportsTools: null,
      supportsImages: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      manual: true
    });
    // Unknown stays unknown, so the writing agent treats it conservatively (FR-003, FR-005).
    expect(canRunAgent(model)).toBe(false);
    expect(unavailableReason(model)).toBe("This provider does not say whether the model supports tools.");
  });

  test("Meta's documented presets apply to a hand-entered Muse Spark id, contributor warning included", () => {
    const standard = manualModel("meta", "muse-spark-1.3");
    expect(standard).toMatchObject({ name: "Muse Spark 1.3", supportsTools: true, contextLength: 1_048_576, manual: true });
    expect(canRunAgent(standard)).toBe(true);
    expect(isContributorModel(standard)).toBe(false);

    const contributor = manualModel("meta", "muse-spark-1.3-contributor");
    expect(contributor).toMatchObject({ trainingOnData: true, manual: true });
    expect(isContributorModel(contributor)).toBe(true);
    expect(contributorWarning(contributor)).toBe(CONTRIBUTOR_WARNING);

    // The preset is Meta's; the same id on another provider claims nothing.
    expect(manualModel("openrouter", "muse-spark-1.3").supportsTools).toBeNull();
  });

  test("a listed model wins over its hand-entered copy", () => {
    const { manual: _manual, ...unmarked } = manualModel("openrouter", "a");
    const listed = { ...unmarked, name: "Listed A", contextLength: 8_000 };
    const merged = withManualModels([listed], [manualModel("openrouter", "a"), manualModel("openrouter", "b")]);
    expect(merged.map((model) => [model.id, model.manual ?? false])).toEqual([
      ["a", false],
      ["b", true]
    ]);
    expect(merged[0]?.name).toBe("Listed A");
  });
});

describe("why a model check failed", () => {
  test("a missing model reads as not found", () => {
    expect(normalizeModelCheckError({ provider: "openai", status: 404 }).code).toBe("not-found");
    expect(normalizeModelCheckError({ provider: "openrouter", status: 400, body: '{"error":{"message":"x is not a valid model ID"}}' }).code).toBe(
      "not-found"
    );
    expect(normalizeModelCheckError({ provider: "anthropic", status: 400, body: '{"error":{"type":"not_found_error"}}' }).code).toBe(
      "not-found"
    );
    expect(normalizeModelCheckError({ provider: "meta", status: 404 }).message).toBe(
      "This connection does not offer a model with that id. Check the spelling and that your account can use it."
    );
  });

  test("everything else keeps the shared mapping", () => {
    expect(normalizeModelCheckError({ provider: "openai", status: 400, body: "max_tokens is too large" }).code).toBe("invalid-request");
    expect(normalizeModelCheckError({ provider: "openai", status: 401 }).code).toBe("auth");
    expect(normalizeModelCheckError({ provider: "openai", status: 403 }).code).toBe("permission");
    expect(normalizeModelCheckError({ provider: "openai", status: 429, retryAfterSeconds: 9 })).toMatchObject({
      code: "rate-limit",
      options: { retryAfterSeconds: 9 }
    });
    expect(normalizeModelCheckError({ provider: "openai", status: 402 }).code).toBe("quota");
    expect(normalizeModelCheckError({ provider: "meta", message: "fetch failed" }).code).toBe("offline");
  });
});

describe("pages the studio opens on request", () => {
  test("the allow-list is exactly OpenRouter's keys page", () => {
    expect(OPENROUTER_KEYS_PAGE_URL).toBe("https://openrouter.ai/settings/keys");
    expect([...EXTERNAL_LINKS]).toEqual(["https://openrouter.ai/settings/keys"]);
  });
});
