/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { claimsSingleInstanceLock, sendWhenLoaded, type SignalTarget } from "../src/main/instance";

/** Spec 002 FR-069: which runs claim the profile's single-instance lock. */
describe("claimsSingleInstanceLock", () => {
  test("every launch the author can see claims the lock", () => {
    expect(claimsSingleInstanceLock({ headless: false, isTest: false, userData: undefined })).toBe(true);
    // STUDIO_TEST=1 STUDIO_VISIBLE=1, on a throwaway profile or on the real one.
    expect(claimsSingleInstanceLock({ headless: false, isTest: true, userData: "/tmp/visible-profile" })).toBe(true);
    expect(claimsSingleInstanceLock({ headless: false, isTest: true, userData: undefined })).toBe(true);
  });

  test("a hidden test run claims the lock on its own throwaway profile", () => {
    expect(claimsSingleInstanceLock({ headless: true, isTest: true, userData: "/tmp/hidden-profile" })).toBe(true);
  });

  test("a hidden run on the real profile claims nothing, so it never refuses the author's window", () => {
    // STUDIO_TEST=1 without STUDIO_USER_DATA, which warns that it uses the real profile.
    expect(claimsSingleInstanceLock({ headless: true, isTest: true, userData: undefined })).toBe(false);
    expect(claimsSingleInstanceLock({ headless: true, isTest: true, userData: "" })).toBe(false);
    // STUDIO_HEADLESS=1 alone is not a test run, so STUDIO_USER_DATA is never applied.
    expect(claimsSingleInstanceLock({ headless: true, isTest: false, userData: "/tmp/ignored-profile" })).toBe(false);
  });
});

function fakeContents(loading: boolean) {
  const sent: string[] = [];
  const awaited: string[] = [];
  const waiting: Array<() => void> = [];
  let destroyed = false;
  const contents: SignalTarget = {
    isDestroyed: () => destroyed,
    isLoading: () => loading,
    once: (event, listener) => {
      awaited.push(event);
      waiting.push(listener);
    },
    send: (channel) => sent.push(channel)
  };
  return {
    contents,
    sent,
    awaited,
    stopLoading() {
      loading = false;
      for (const listener of waiting.splice(0)) listener();
    },
    destroy() {
      destroyed = true;
    }
  };
}

describe("sendWhenLoaded", () => {
  test("a loaded page hears the signal at once", () => {
    const page = fakeContents(false);
    sendWhenLoaded(page.contents, "app:second-instance");
    expect(page.sent).toEqual(["app:second-instance"]);
  });

  test("a page that is still loading hears it once loading stops, not before", () => {
    const page = fakeContents(true);
    sendWhenLoaded(page.contents, "app:second-instance");
    expect(page.sent).toEqual([]);
    expect(page.awaited).toEqual(["did-stop-loading"]);
    page.stopLoading();
    expect(page.sent).toEqual(["app:second-instance"]);
  });

  test("a window closed while its page loads is sent nothing", () => {
    const page = fakeContents(true);
    sendWhenLoaded(page.contents, "app:second-instance");
    page.destroy();
    page.stopLoading();
    expect(page.sent).toEqual([]);
  });
});
