import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PROVIDER_LIST } from "@ai-book-studio/core/providers/registry";

/**
 * Every served web route carries a content security policy, and the product page may contact
 * only the providers the browser build is actually allowed to reach. The registry is the
 * capability table: `no` and `unknown` providers stay desktop-only, so their hosts must never
 * appear in a served connect-src. The local check harnesses contact nothing external at all.
 */
const CHECK_PAGES = ["check/gallery.html", "check/index.html", "check/restart.html"];

function cspOf(file: string): string {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  expect(match, `${file} declares a content security policy`).not.toBeNull();
  return match?.[1] ?? "";
}

function connectSrc(csp: string): string {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src"));
  expect(directive).toBeDefined();
  return directive ?? "";
}

describe("web content security policy", () => {
  test("the product page allows only itself and OpenRouter", () => {
    const connect = connectSrc(cspOf("index.html"));
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://openrouter.ai");
    expect(connect).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/);
    for (const provider of PROVIDER_LIST) {
      if (provider.browserAccess === "no" || provider.browserAccess === "unknown") {
        for (const host of provider.hosts) {
          expect(connect).not.toContain(new URL(host).hostname);
        }
      }
    }
  });

  test.each(CHECK_PAGES)("the %s harness contacts nothing external", (file) => {
    const csp = cspOf(file);
    expect(connectSrc(csp)).toBe("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/(?:^|\s)https?:(?:\s|;|$)/);
  });
});
