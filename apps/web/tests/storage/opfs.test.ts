import { afterEach, describe, expect, test } from "bun:test";
import { openBrowserLibrary } from "../../src/storage/opfs";

type GlobalWithNavigator = { navigator?: unknown };
const globals = globalThis as GlobalWithNavigator;
const original = globals.navigator;

afterEach(() => {
  if (original === undefined) delete globals.navigator;
  else globals.navigator = original;
});

describe("origin storage opening", () => {
  test("a hanging OPFS open fails quickly with a recovery message", async () => {
    globals.navigator = { storage: { getDirectory: () => new Promise(() => {}) } };

    const started = Date.now();
    await expect(openBrowserLibrary("library_test", { timeoutMs: 25 })).rejects.toMatchObject({
      code: "unsupported",
      message: expect.stringContaining("Choose a folder")
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("a rejected OPFS open gets the same recovery message", async () => {
    globals.navigator = {
      storage: {
        getDirectory: async () => {
          throw new Error("The operation failed for an unknown transient reason.");
        }
      }
    };

    await expect(openBrowserLibrary("library_test", { timeoutMs: 25 })).rejects.toMatchObject({
      code: "unsupported",
      message: expect.stringContaining("origin storage")
    });
  });
});
