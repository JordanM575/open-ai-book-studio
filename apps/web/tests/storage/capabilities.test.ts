import { afterEach, describe, expect, test } from "bun:test";
import { detectStorageCapabilities } from "../../src/storage/capabilities";
import { requestPersistence } from "../../src/storage/opfs";

type GlobalWithBrowser = {
  window?: unknown;
  navigator?: unknown;
  isSecureContext?: unknown;
};
const globals = globalThis as GlobalWithBrowser;
const original = {
  window: globals.window,
  navigator: globals.navigator,
  isSecureContext: globals.isSecureContext
};

function restore(key: keyof typeof original): void {
  const value = original[key];
  if (value === undefined) delete globals[key];
  else globals[key] = value;
}

afterEach(() => {
  restore("window");
  restore("navigator");
  restore("isSecureContext");
});

describe("browser storage capabilities", () => {
  test("detects each feature without browser-name sniffing", () => {
    globals.window = { showDirectoryPicker: () => {} };
    globals.navigator = { storage: { getDirectory: () => {}, persist: () => {} }, locks: {} };
    globals.isSecureContext = true;

    expect(detectStorageCapabilities()).toEqual({
      secureContext: true,
      folderAccess: true,
      browserStorage: true,
      persistence: true,
      locks: true
    });

    globals.isSecureContext = false;
    expect(detectStorageCapabilities().folderAccess).toBe(false);

    globals.window = {};
    globals.isSecureContext = true;
    const noPicker = detectStorageCapabilities();
    expect(noPicker.folderAccess).toBe(false);
    expect(noPicker.browserStorage).toBe(true);
  });

  test("reports persistence denial, unsupported and failure honestly", async () => {
    globals.navigator = {};
    expect(await requestPersistence()).toBe("not-supported");

    globals.navigator = { storage: { persist: async () => true } };
    expect(await requestPersistence()).toBe("granted");

    globals.navigator = { storage: { persist: async () => false } };
    expect(await requestPersistence()).toBe("not-granted");

    globals.navigator = {
      storage: {
        persist: async () => {
          throw new Error("denied");
        }
      }
    };
    expect(await requestPersistence()).toBe("not-granted");
  });
});
