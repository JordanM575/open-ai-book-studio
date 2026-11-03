import { describe, expect, test } from "bun:test";
import { summarizeAxe } from "../../../scripts/accessibility-gate.mjs";

function violation(impact: string, id: string) {
  return { impact, id, help: `${id} help`, nodes: [] };
}

describe("accessibility gate", () => {
  test("critical and serious findings fail the gate", () => {
    const { failing, reported } = summarizeAxe([
      violation("critical", "button-name"),
      violation("serious", "label-content-name-mismatch"),
      violation("moderate", "landmark-one-main"),
      violation("minor", "region")
    ]);
    expect(failing.map((entry) => entry.id)).toEqual(["button-name", "label-content-name-mismatch"]);
    expect(reported.map((entry) => entry.id)).toEqual(["landmark-one-main", "region"]);
  });

  test("a clean scan passes with nothing reported", () => {
    expect(summarizeAxe([])).toEqual({ failing: [], reported: [] });
    expect(summarizeAxe([violation("moderate", "region")]).failing).toEqual([]);
  });
});
