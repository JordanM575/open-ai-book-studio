/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { LicenseReport } from "@ai-book-studio/core/licenses";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let OpenSourceLicenses!: typeof import("@ai-book-studio/app/components/LicensesDialog").OpenSourceLicenses;

beforeAll(async () => {
  testing = await mountDom();
  ({ OpenSourceLicenses } = await import("@ai-book-studio/app/components/LicensesDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/*
 * D-186: Settings → About → Open-source licenses. The view reads the list the build generated, puts
 * the studio's own license first, filters by search and shows the selected package's license text.
 */

function entry(name: string, license: string | null, text: string | null, extra: Partial<LicenseReport["packages"][number]> = {}) {
  return {
    name,
    version: "1.0.0",
    license,
    repository: null,
    homepage: null,
    author: null,
    texts: text === null ? [] : [{ file: "LICENSE", text }],
    note: null,
    exception: null,
    ...extra
  };
}

const REPORT: LicenseReport = {
  schemaVersion: 1,
  target: "desktop",
  project: {
    name: "Open Book Studio",
    version: "0.1.0",
    license: "Apache-2.0",
    texts: [
      { file: "LICENSE", text: "Studio license fixture." },
      { file: "NOTICE", text: "Studio notice fixture." }
    ]
  },
  packages: [
    entry("alpha", "MIT", "Alpha license fixture."),
    entry("beta", "ISC", "Beta license fixture.", { author: "Beta Author" }),
    entry("bundled-parser", "SEE LICENSE IN LICENSE", "Parser license fixture.", {
      exception: { label: "Custom license, not Apache-2.0", reason: "Synthetic reason for the exception." }
    }),
    entry("no-file", "MIT", null, { repository: "https://example.com/no-file" })
  ]
};

function mockLicenses(result: unknown) {
  const licenses = mock(async () => result);
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = { app: { licenses } };
  return licenses;
}

async function openView() {
  const view = testing.within(document.body);
  testing.fireEvent.click(view.getByTestId("show-licenses"));
  await testing.waitFor(() => expect(view.getByTestId("licenses-list")).toBeTruthy(), { timeout: 2000 });
  return view;
}

function listed(view: { getAllByTestId: (id: string) => HTMLElement[] }): string[] {
  return view.getAllByTestId("licenses-option").map((option) => option.getAttribute("data-package") ?? "(studio)");
}

describe("open-source licenses view", () => {
  test("reads the list only when opened and shows the studio's own license and notice first", async () => {
    const licenses = mockLicenses({ ok: true, data: REPORT });
    testing.render(React.createElement(OpenSourceLicenses));
    expect(licenses).not.toHaveBeenCalled();
    const view = await openView();
    expect(licenses).toHaveBeenCalledTimes(1);
    expect(listed(view)).toEqual(["(studio)", "alpha", "beta", "bundled-parser", "no-file"]);
    const text = view.getByTestId("licenses-text").textContent ?? "";
    expect(text).toContain("Open Book Studio");
    expect(text).toContain("Studio license fixture.");
    expect(text).toContain("Studio notice fixture.");
    expect(view.getByTestId("licenses-count").textContent).toBe("4 packages");
    expect(document.activeElement).toBe(view.getByTestId("licenses-search"));
  });

  test("search filters the list and selecting a package shows its license text", async () => {
    mockLicenses({ ok: true, data: REPORT });
    testing.render(React.createElement(OpenSourceLicenses));
    const view = await openView();
    testing.fireEvent.change(view.getByTestId("licenses-search"), { target: { value: "be" } });
    expect(listed(view)).toEqual(["(studio)", "beta"]);
    expect(view.getByTestId("licenses-count").textContent).toBe("1 of 4 packages");

    const beta = view.getAllByTestId("licenses-option").find((option) => option.getAttribute("data-package") === "beta");
    if (!beta) throw new Error("beta is not listed");
    testing.fireEvent.click(beta);
    expect(beta.getAttribute("aria-selected")).toBe("true");
    const text = view.getByTestId("licenses-text").textContent ?? "";
    expect(text).toContain("Beta license fixture.");
    expect(text).toContain("1.0.0 · ISC · Beta Author");
    expect(text).not.toContain("Studio license fixture.");

    testing.fireEvent.change(view.getByTestId("licenses-search"), { target: { value: "zzz" } });
    expect(listed(view)).toEqual(["(studio)"]);
    expect(view.getByTestId("licenses-count").textContent).toBe("No packages match “zzz”");
  });

  test("the arrow keys move the selection and the text follows it", async () => {
    mockLicenses({ ok: true, data: REPORT });
    testing.render(React.createElement(OpenSourceLicenses));
    const view = await openView();
    const list = view.getByTestId("licenses-list");
    testing.fireEvent.keyDown(view.getByTestId("licenses-search"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(list);
    testing.fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(view.getByTestId("licenses-text").textContent).toContain("Alpha license fixture.");
    const active = list.getAttribute("aria-activedescendant");
    expect(active ? document.getElementById(active)?.getAttribute("data-package") : null).toBe("alpha");
    testing.fireEvent.keyDown(list, { key: "End" });
    expect(view.getByTestId("licenses-text").textContent).toContain("ships no license file of its own");
    testing.fireEvent.keyDown(list, { key: "Home" });
    expect(view.getByTestId("licenses-text").textContent).toContain("Studio license fixture.");
  });

  test("an allowed exception reads by its label and gives its reason", async () => {
    mockLicenses({ ok: true, data: REPORT });
    testing.render(React.createElement(OpenSourceLicenses));
    const view = await openView();
    testing.fireEvent.change(view.getByTestId("licenses-search"), { target: { value: "parser" } });
    const parser = view.getAllByTestId("licenses-option").find((option) => option.getAttribute("data-package") === "bundled-parser");
    expect(parser?.textContent).toContain("Custom license, not Apache-2.0");
    expect(parser?.textContent).not.toContain("SEE LICENSE IN LICENSE");
    // The studio's own entry is never filtered out, so it stays selected until a package is chosen.
    expect(view.getByTestId("licenses-text").textContent).toContain("Studio license fixture.");
    if (parser) testing.fireEvent.click(parser);
    expect(view.getByTestId("licenses-text").textContent).toContain("Allowed exception: Synthetic reason for the exception.");
  });

  test("a list that cannot be read says so", async () => {
    mockLicenses({ ok: false, error: { code: "internal", message: "This build's list of open-source licenses could not be read." } });
    testing.render(React.createElement(OpenSourceLicenses));
    const view = testing.within(document.body);
    testing.fireEvent.click(view.getByTestId("show-licenses"));
    await testing.waitFor(() => expect(view.getByRole("alert").textContent).toContain("could not be read"), { timeout: 2000 });
    expect(view.queryByTestId("licenses-list")).toBeNull();
  });
});
