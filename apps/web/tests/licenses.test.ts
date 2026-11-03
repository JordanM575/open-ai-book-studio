import { describe, expect, test } from "bun:test";
import type { LicenseReport } from "@ai-book-studio/core/licenses";
import { fetchLicenses } from "../src/runtime/licenses";

/*
 * D-186: the browser build reads the license list its build wrote beside index.html, from its own
 * origin and relative to the page, so a build served from a subpath still finds it.
 */

const REPORT: LicenseReport = {
  schemaVersion: 1,
  target: "web",
  project: { name: "AI Book Studio", version: "0.1.0", license: "Apache-2.0", texts: [{ file: "LICENSE", text: "Studio license." }] },
  packages: [
    {
      name: "react",
      version: "19.3.1",
      license: "MIT",
      repository: "https://github.com/facebook/react",
      homepage: null,
      author: null,
      texts: [{ file: "LICENSE", text: "Synthetic MIT text." }],
      note: null,
      exception: null
    }
  ]
};

function respond(body: unknown, status = 200): { load: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const load = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { load, requested };
}

describe("web license list", () => {
  test("is fetched beside the page, even from a subpath, and validated", async () => {
    const { load, requested } = respond(REPORT);
    const report = await fetchLicenses("https://studio.example/books/index.html", load);
    expect(requested).toEqual(["https://studio.example/books/licenses.json"]);
    expect(report.packages.map((pkg) => pkg.name)).toEqual(["react"]);
  });

  test("a missing, foreign or unreachable list fails in the author's words", async () => {
    await expect(fetchLicenses("https://studio.example/", respond({}, 404).load)).rejects.toThrow(
      "This build has no list of open-source licenses."
    );
    await expect(fetchLicenses("https://studio.example/", respond({ ...REPORT, target: "desktop" }).load)).rejects.toThrow(
      "could not be read"
    );
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchLicenses("https://studio.example/", offline)).rejects.toThrow("could not be loaded");
  });
});
