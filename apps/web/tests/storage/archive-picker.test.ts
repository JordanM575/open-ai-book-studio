/// <reference types="bun" />
import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registered = typeof document === "undefined";
if (registered) GlobalRegistrator.register({ url: "http://localhost" });
const { pickArchiveFile } = await import("../../src/storage/archive-io");

afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

describe("archive file picker", () => {
  test("returns the chosen archive and treats cancel as no selection", async () => {
    const file = new File(["zip"], "library.zip", { type: "application/zip" });
    let mode: "select" | "cancel" = "select";
    const original = HTMLInputElement.prototype.click;

    HTMLInputElement.prototype.click = function () {
      if (this.type !== "file") return;
      if (mode === "cancel") {
        this.dispatchEvent(new Event("cancel"));
        return;
      }
      Object.defineProperty(this, "files", { value: [file], configurable: true });
      this.dispatchEvent(new Event("change"));
    };

    try {
      expect(await pickArchiveFile()).toBe(file);
      mode = "cancel";
      expect(await pickArchiveFile()).toBeNull();
    } finally {
      HTMLInputElement.prototype.click = original;
    }
  });
});
