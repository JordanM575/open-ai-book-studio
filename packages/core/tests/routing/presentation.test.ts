import { describe, expect, test } from "bun:test";
import { catalogueAgeLine, contextView, unitPriceViews } from "../../src/routing/index";
import type { ModelInfo } from "../../src/providers/types";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");

function model(overrides: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    name: overrides.id,
    contextLength: 128000,
    supportsTools: true,
    supportsImages: true,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
    ...overrides
  };
}

describe("routing presentation", () => {
  test("known unit prices keep their values and provenance", () => {
    const views = unitPriceViews(
      model({ id: "acme/large", inputPricePerMillion: 1.25, outputPricePerMillion: 5, cachedInputPricePerMillion: 0.002 })
    );
    expect(views.map((view) => [view.field, view.state, view.valuePerMillionUsd, view.text])).toEqual([
      ["input", "known", 1.25, "USD 1.25 per million tokens"],
      ["output", "known", 5, "USD 5 per million tokens"],
      ["cached-input", "known", 0.002, "USD 0.002 per million tokens"]
    ]);
    for (const view of views) {
      expect(view.note).toBe("Published in the provider catalogue, in USD per million tokens.");
    }
    expect(views.map((view) => view.label)).toEqual(["Input", "Output", "Cached input"]);
  });

  test("missing prices stay unknown and are never zero", () => {
    const views = unitPriceViews(
      model({ id: "acme/mystery", inputPricePerMillion: null, outputPricePerMillion: null })
    );
    expect(views.map((view) => [view.field, view.state, view.valuePerMillionUsd, view.text])).toEqual([
      ["input", "unknown", null, "Unknown"],
      ["output", "unknown", null, "Unknown"],
      ["cached-input", "unknown", null, "Unknown"]
    ]);
    for (const view of views) {
      expect(view.valuePerMillionUsd).not.toBe(0);
      expect(view.note).toBe("The provider does not publish this price.");
    }
  });

  test("a published zero price is known, not unknown", () => {
    const views = unitPriceViews(model({ id: "acme/free", inputPricePerMillion: 0 }));
    const input = views.find((view) => view.field === "input");
    expect(input?.state).toBe("known");
    expect(input?.valuePerMillionUsd).toBe(0);
    expect(input?.text).toBe("USD 0 per million tokens");
  });

  test("an unusable price is unknown", () => {
    const views = unitPriceViews(model({ id: "acme/broken", inputPricePerMillion: NaN }));
    const input = views.find((view) => view.field === "input");
    expect(input?.state).toBe("unknown");
    expect(input?.valuePerMillionUsd).toBeNull();
  });

  test("a known context limit is catalogue data with unknown fit", () => {
    const view = contextView(model({ id: "acme/large", contextLength: 1048576 }));
    expect(view).toEqual({
      state: "known",
      tokens: 1048576,
      text: "1,048,576 tokens (catalogue)",
      note: "Catalogue context limit. It does not say whether a particular request fits.",
      fit: "unknown",
      fitNote: "Request fit is unknown. No tested estimator provides the request size."
    });
  });

  test("a smaller context limit groups its digits", () => {
    expect(contextView(model({ id: "acme/small", contextLength: 8000 })).text).toBe("8,000 tokens (catalogue)");
  });

  test("an unknown context size stays unknown with the existing reason", () => {
    const view = contextView(model({ id: "acme/mystery", contextLength: null }));
    expect(view.state).toBe("unknown");
    expect(view.tokens).toBeNull();
    expect(view.text).toBe("Unknown");
    expect(view.note).toBe("This provider does not report the model's context size.");
    expect(view.fit).toBe("unknown");
  });

  test("a fresh catalogue shows its age", () => {
    expect(catalogueAgeLine({ fetchedAt: new Date(NOW - 30_000).toISOString(), freshness: "fresh" }, NOW)).toBe(
      "Checked just now."
    );
    expect(catalogueAgeLine({ fetchedAt: new Date(NOW - 60_000).toISOString(), freshness: "fresh" }, NOW)).toBe(
      "Checked 1 minute ago."
    );
    expect(catalogueAgeLine({ fetchedAt: new Date(NOW - 5 * 60_000).toISOString(), freshness: "fresh" }, NOW)).toBe(
      "Checked 5 minutes ago."
    );
    expect(
      catalogueAgeLine({ fetchedAt: new Date(NOW - 3 * 3_600_000).toISOString(), freshness: "fresh" }, NOW)
    ).toBe("Checked 3 hours ago.");
    expect(
      catalogueAgeLine({ fetchedAt: new Date(NOW - 3 * 86_400_000).toISOString(), freshness: "fresh" }, NOW)
    ).toBe("Checked 3 days ago.");
  });

  test("a stale catalogue is labelled with its age and a warning", () => {
    expect(catalogueAgeLine({ fetchedAt: new Date(NOW - 25 * 3_600_000).toISOString(), freshness: "stale" }, NOW)).toBe(
      "Checked 1 day ago. This catalogue may be out of date."
    );
    expect(catalogueAgeLine({ fetchedAt: new Date(NOW - 10_000).toISOString(), freshness: "stale" }, NOW)).toBe(
      "Checked just now. This catalogue may be out of date."
    );
  });

  test("a missing or unusable timestamp is unknown, never guessed", () => {
    expect(catalogueAgeLine({ fetchedAt: null, freshness: "absent" }, NOW)).toBe("Check time unknown.");
    expect(catalogueAgeLine({ fetchedAt: "not-a-date", freshness: "absent" }, NOW)).toBe("Check time unknown.");
    expect(catalogueAgeLine({ fetchedAt: new Date(NOW + 60_000).toISOString(), freshness: "fresh" }, NOW)).toBe(
      "Check time unknown."
    );
  });

  test("no total, ceiling or rejection is presented", () => {
    const priced = unitPriceViews(model({ id: "acme/large" }));
    expect(JSON.stringify(priced)).not.toContain("total");
    expect(JSON.stringify(priced)).not.toContain("ceiling");
    const fitted = contextView(model({ id: "acme/large" }));
    expect(fitted.fit).toBe("unknown");
  });
});
