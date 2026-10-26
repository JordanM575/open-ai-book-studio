import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import { BrowserLibraries } from "../../src/runtime/browser-libraries";
import { FakeDirectory } from "./support/fake-directory";

function folderWithPermission(state: "granted" | "denied"): FileSystemDirectoryHandle {
  const root = new FakeDirectory("Novel");
  Object.defineProperty(root, "requestPermission", {
    value: async () => state
  });
  return root as unknown as FileSystemDirectoryHandle;
}

describe("browser permission recovery", () => {
  test("reconnect re-grants a folder and opens it", async () => {
    const libraries = new BrowserLibraries();
    const folder = folderWithPermission("granted");
    libraries.pendingFolder = folder;

    const info = await libraries.reconnectFolder();

    expect(info.root).toBe("folder://Novel");
    expect(libraries.pendingFolder).toBeNull();
  });

  test("a denied re-grant keeps the folder pending and does not switch tiers", async () => {
    const libraries = new BrowserLibraries();
    const folder = folderWithPermission("denied");
    libraries.pendingFolder = folder;

    await expect(libraries.reconnectFolder()).rejects.toMatchObject({ code: "permission-required" });
    expect(libraries.pendingFolder).toBe(folder);
    expect(libraries.service).toBeNull();
  });
});
