/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { ModelInfo } from "@ai-book-studio/core/providers/types";
import type { TaskPreviewData } from "@ai-book-studio/app/components/TaskPreviewDialog";
import { mountDom, unmountDom } from "./support/dom";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const FRESH_AT = new Date(NOW - 5 * 60_000).toISOString();

let testing!: typeof import("@testing-library/react/pure");
let TaskPreviewDialog!: typeof import("@ai-book-studio/app/components/TaskPreviewDialog").TaskPreviewDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ TaskPreviewDialog } = await import("@ai-book-studio/app/components/TaskPreviewDialog"));
});
afterAll(async () => {
  await unmountDom();
});
afterEach(() => {
  testing.cleanup();
  document.documentElement.removeAttribute("data-theme");
});

function model(overrides: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    name: overrides.id,
    contextLength: 128000,
    supportsTools: true,
    supportsImages: false,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
    ...overrides
  };
}

function previewData(): TaskPreviewData {
  return {
    profiles: [
      { id: "drafting", name: "Drafting", purpose: "Turn notes into prose.", version: 1, requirements: { requiresTools: true, minContextLength: 32000 } },
      { id: "notes", name: "Notes", purpose: "Sketch without tools.", version: 1, requirements: { requiresTools: false } }
    ],
    catalogues: [
      {
        provider: "openrouter",
        catalogue: { models: [model({ id: "acme/large" }), model({ id: "acme/chat", supportsTools: false })], fetchedAt: FRESH_AT }
      }
    ],
    connections: [
      { id: "conn_test01", provider: "openrouter", label: "Test key", kind: "api-key", createdAt: "2026-11-01T00:00:00.000Z" }
    ],
    build: "desktop"
  };
}

function openPreview() {
  return testing.render(
    React.createElement(TaskPreviewDialog, {
      open: true,
      data: previewData(),
      now: NOW,
      onClose: mock(() => {}),
      onOpenModelPicker: mock(() => {})
    })
  );
}

describe("task preview access", () => {
  test("the dialog announces itself and every control has a visible name", async () => {
    openPreview();
    const dialog = await testing.within(document.body).findByRole("dialog", { name: "Preview models" });
    expect(dialog.textContent).toContain("Looking never changes your model or sends a request.");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const name = (button.textContent ?? "").trim() || (button.getAttribute("aria-label") ?? "");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("profile buttons expose pressed state and take focus", async () => {
    const view = openPreview();
    await testing.within(document.body).findByTestId("task-preview");
    const drafting = view.getByRole("button", { name: /Drafting/ });
    expect(drafting.getAttribute("aria-pressed")).toBe("false");
    await testing.act(async () => {
      await testing.fireEvent.click(drafting);
    });
    expect(view.getByRole("button", { name: /Drafting/ }).getAttribute("aria-pressed")).toBe("true");
    expect(view.getByRole("button", { name: /Notes/ }).getAttribute("aria-pressed")).toBe("false");
    (view.getByRole("button", { name: /Notes/ }) as HTMLElement).focus();
    expect(document.activeElement?.textContent).toContain("Notes");
  });

  test("reasons render as a real list beside their status", async () => {
    const view = openPreview();
    await testing.within(document.body).findByTestId("task-preview");
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByText("Drafting"));
    });
    const list = view.getByTestId("task-preview-candidates");
    expect(list.querySelector("ul")).not.toBeNull();
    expect(list.textContent).toContain("Not suitable");
    expect(list.textContent).toContain("This model cannot use tools, which the writing agent needs.");
  });

  test("nothing animates inline: motion stays in the stylesheet guard", async () => {
    const view = openPreview();
    await testing.within(document.body).findByTestId("task-preview");
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByText("Drafting"));
    });
    const dialog = await testing.within(document.body).findByRole("dialog", { name: "Preview models" });
    const styled = Array.from(dialog.querySelectorAll("[style]"));
    for (const element of styled) {
      expect(element.getAttribute("style") ?? "").not.toMatch(/animation|transition/);
    }
  });

  test("light and dark render the same content with token-only styling", async () => {
    const view = openPreview();
    await testing.within(document.body).findByTestId("task-preview");
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByText("Drafting"));
    });
    const light = view.getByTestId("task-preview-candidates").textContent ?? "";
    expect(light.length).toBeGreaterThan(0);
    testing.cleanup();
    document.documentElement.setAttribute("data-theme", "dark");
    const darkView = openPreview();
    await testing.within(document.body).findByTestId("task-preview");
    await testing.act(async () => {
      await testing.fireEvent.click(darkView.getByText("Drafting"));
    });
    expect(darkView.getByTestId("task-preview-candidates").textContent).toBe(light);
    const dialog = await testing.within(document.body).findByRole("dialog", { name: "Preview models" });
    const painted = Array.from(dialog.querySelectorAll("[style]"));
    for (const element of painted) {
      const inline = element.getAttribute("style") ?? "";
      expect(inline).not.toMatch(/animation|transition/);
      expect(inline).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
    }
    const classes = Array.from(dialog.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  });
});
