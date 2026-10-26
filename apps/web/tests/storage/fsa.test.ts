import { afterEach, describe, expect, test } from "bun:test";
import { chooseFolder, folderPermission, folderSummary, requestFolderPermission } from "../../src/storage/fsa";

type PermissionState = "granted" | "denied" | "prompt";
type GlobalWithWindow = { window?: unknown };

function handle(overrides: Record<string, unknown> = {}): FileSystemDirectoryHandle {
  return { name: "Folder", ...overrides } as unknown as FileSystemDirectoryHandle;
}

const originalWindow = (globalThis as GlobalWithWindow).window;

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as GlobalWithWindow).window;
  else (globalThis as GlobalWithWindow).window = originalWindow;
});

describe("folder access", () => {
  test("choosing a folder returns the picked handle", async () => {
    const picked = handle({ name: "Novel" });
    (globalThis as GlobalWithWindow).window = { showDirectoryPicker: async () => picked };

    expect(await chooseFolder()).toBe(picked);
  });

  test("cancelling the picker is not an error", async () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    (globalThis as GlobalWithWindow).window = {
      showDirectoryPicker: async () => {
        throw abort;
      }
    };

    expect(await chooseFolder()).toBeNull();
  });

  test("a browser without a picker explains the alternative", async () => {
    (globalThis as GlobalWithWindow).window = {};

    await expect(chooseFolder()).rejects.toMatchObject({ code: "unsupported" });
  });

  test("permission states map without switching storage tiers", async () => {
    const state = (value: PermissionState) => handle({ queryPermission: async () => value });
    const request = (value: PermissionState) => handle({ requestPermission: async () => value });

    expect(await folderPermission(state("granted"))).toBe("granted");
    expect(await folderPermission(state("prompt"))).toBe("needs-action");
    expect(await folderPermission(state("denied"))).toBe("unavailable");
    expect(await folderPermission(handle())).toBe("granted");

    expect(await requestFolderPermission(request("granted"))).toBe("granted");
    expect(await requestFolderPermission(request("prompt"))).toBe("needs-action");
    expect(await requestFolderPermission(request("denied"))).toBe("unavailable");
    expect(await requestFolderPermission(handle())).toBe("granted");
  });

  test("the folder summary carries the read-only warning", () => {
    const summary = folderSummary(handle({ name: "Novel" }), "read-only");

    expect(summary.tier).toBe("folder");
    expect(summary.label).toBe("Novel");
    expect(summary.warning).toContain("read-only");
  });
});
