import { describe, expect, test } from "bun:test";
import { launchMode } from "../src/main/launch-mode";

describe("launch mode", () => {
  test("a test run is hidden unless it asks to be seen", () => {
    expect(launchMode({ STUDIO_TEST: "1" })).toEqual({ isTest: true, headless: true });
    expect(launchMode({ STUDIO_TEST: "1", STUDIO_VISIBLE: "1" })).toEqual({ isTest: true, headless: false });
  });

  test("a visible test run stays on screen even with the headless flag", () => {
    expect(launchMode({ STUDIO_TEST: "1", STUDIO_VISIBLE: "1", STUDIO_HEADLESS: "1" })).toEqual({
      isTest: true,
      headless: false
    });
  });

  test("the app is on screen unless the headless flag hides it", () => {
    expect(launchMode({})).toEqual({ isTest: false, headless: false });
    expect(launchMode({ STUDIO_VISIBLE: "1" })).toEqual({ isTest: false, headless: false });
    expect(launchMode({ STUDIO_TEST: "0", STUDIO_HEADLESS: "0" })).toEqual({ isTest: false, headless: false });
    expect(launchMode({ STUDIO_HEADLESS: "1" })).toEqual({ isTest: false, headless: true });
  });
});
