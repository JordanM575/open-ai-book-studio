import { afterEach, describe, expect, test } from "bun:test";
import { webLock, webLocksAvailable } from "../../src/storage/directory-port";

type GlobalWithNavigator = { navigator?: unknown };
const globals = globalThis as GlobalWithNavigator;
const original = globals.navigator;

afterEach(() => {
  if (original === undefined) delete globals.navigator;
  else globals.navigator = original;
});

describe("cross-tab Web Locks", () => {
  test("runs the work without a lock when the browser has none", async () => {
    globals.navigator = {};
    expect(webLocksAvailable()).toBe(false);

    const result = await webLock("write:one", async () => "written");
    expect(result).toBe("written");
  });

  test("requests an exclusive namespaced lock when available", async () => {
    const calls: Array<{ name: string; options: unknown }> = [];
    globals.navigator = {
      locks: {
        request: async (name: string, options: unknown, work: () => Promise<unknown>) => {
          calls.push({ name, options });
          return work();
        }
      }
    };
    expect(webLocksAvailable()).toBe(true);

    const result = await webLock("write:one", async () => "locked");

    expect(result).toBe("locked");
    expect(calls).toEqual([{ name: "ai-book-studio:write:one", options: { mode: "exclusive" } }]);
  });
});
