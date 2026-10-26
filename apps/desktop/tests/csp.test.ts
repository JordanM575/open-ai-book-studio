import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PROVIDER_LIST } from "@ai-book-studio/core/providers/registry";

/**
 * The renderer must never be able to reach a model provider. Model traffic and keys live in the main
 * process, so the content security policy of the renderer excludes every host the registry knows.
 * This test fails when someone adds a provider host to the renderer or forgets the base policy.
 */
describe("renderer content security policy", () => {
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);

  test("declares a content security policy", () => {
    expect(match).not.toBeNull();
  });

  test("allows only local connections", () => {
    const csp = match?.[1] ?? "";
    const connect = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"));
    expect(connect).toBeDefined();
    expect(connect).toContain("'self'");
    for (const provider of PROVIDER_LIST) {
      for (const host of provider.hosts) {
        expect(connect).not.toContain(new URL(host).hostname);
      }
    }
  });
});
