import { describe, expect, test } from "bun:test";
import { contributorFrom } from "../src/main/live-checks";

/**
 * Which Contributor model a live check runs on.
 *
 * The catalogue offers more than one, and the first live run took whichever came first in the
 * list — `muse-spark-1.2-contributor` — while the spec and the submission described
 * `muse-spark-1.3-contributor`. A check that measures a different model than the one the document
 * names is worse than no check, because it reads as proof.
 */
describe("choosing the Contributor model", () => {
  const catalogue = [
    "muse-image-1.0",
    "muse-spark-1.1",
    "muse-spark-1.2",
    "muse-spark-1.2-contributor",
    "muse-spark-1.3",
    "muse-spark-1.3-contributor",
    "muse-voice-transcribe-1.0"
  ];

  test("prefers the model the spec names, wherever it sits in the list", () => {
    expect(contributorFrom(catalogue)).toBe("muse-spark-1.3-contributor");
    expect(contributorFrom([...catalogue].reverse())).toBe("muse-spark-1.3-contributor");
  });

  test("takes the newest Contributor the key offers when the named one is absent", () => {
    const older = catalogue.filter((id) => id !== "muse-spark-1.3-contributor");
    expect(contributorFrom(older)).toBe("muse-spark-1.2-contributor");
    // Two digits matter: 1.10 is newer than 1.9, and a string sort would say otherwise.
    expect(contributorFrom(["muse-spark-1.9-contributor", "muse-spark-1.10-contributor"])).toBe(
      "muse-spark-1.10-contributor"
    );
  });

  test("falls back to a Muse model, then to whatever the key has", () => {
    expect(contributorFrom(["gpt-4o", "muse-spark-1.1"])).toBe("muse-spark-1.1");
    expect(contributorFrom(["only-model"])).toBe("only-model");
  });

  test("says nothing rather than guessing when the catalogue is empty", () => {
    expect(contributorFrom([])).toBe("");
  });
});
