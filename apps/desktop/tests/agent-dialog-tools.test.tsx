/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { AgentStatus, AgentToolStatus } from "@ai-book-studio/core/agent/metrics";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let AgentDialog!: typeof import("@ai-book-studio/app/components/AgentDialog").AgentDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ AgentDialog } = await import("@ai-book-studio/app/components/AgentDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

function tool(name: string, tier: AgentToolStatus["tier"], calls = 0, failures = 0, enabled = true): AgentToolStatus {
  const successes = calls - failures;
  return {
    name,
    description: `The ${name} tool.`,
    tier,
    enabled,
    calls,
    successes,
    failures,
    successRate: calls === 0 ? 0 : successes / calls
  };
}

function statusFixture(tools: AgentToolStatus[]): AgentStatus {
  return {
    tools,
    toolTotals: { tools: [], calls: 0, failures: 0 },
    tone: "",
    answerLength: "standard",
    spending: {
      perTurnCeilingUsd: null,
      monthlyWarningUsd: null,
      monthToDateUsd: 0,
      monthUnknownCostTurns: 0,
      lastTurnWarning: null,
      monthlyWarning: null
    },
    skills: { present: false, enabled: true, characters: 0 },
    cache: { cachedInputTokens: 0, freshInputTokens: 0, hitRate: null, turnsWithCache: 0, turns: 0, mode: "auto" },
    plugins: { folder: null, loaded: [], tools: [], failures: [] }
  };
}

/**
 * A studio that withdraws and restores tools the way the main process does: the patch names every
 * tool that is off, and the answer is the whole status again. `hold` keeps the next answer back until
 * the test lets it go, so the switch can be looked at while the save is still on its way.
 */
function mockStudio(tools: AgentToolStatus[]) {
  let current = statusFixture(tools);
  const patches: Array<{ disabledTools?: string[] }> = [];
  let held: (() => void) | null = null;
  const control = {
    patches,
    hold: false,
    release: () => {
      held?.();
      held = null;
    }
  };
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    agent: {
      status: mock(async () => ({ ok: true, data: current })),
      setSettings: mock(async (_bookId: string, patch: { disabledTools?: string[] }) => {
        patches.push(patch);
        if (control.hold) await new Promise<void>((resolve) => (held = resolve));
        const off = new Set(patch.disabledTools ?? []);
        current = { ...current, tools: current.tools.map((entry) => ({ ...entry, enabled: !off.has(entry.name) })) };
        return { ok: true, data: current };
      }),
      bridge: mock(async () => ({ ok: true, data: { running: false, url: null, token: null } }))
    }
  };
  return control;
}

function dialog(open: boolean) {
  return React.createElement(AgentDialog, { open, bookId: "book_test0001", onClose: () => {}, onNotice: () => {} });
}

const TOOLS = [
  tool("read_chapter", "read", 4),
  tool("find_in_chapter", "read", 3, 1),
  tool("append_to_chapter", "write")
];

/**
 * The Agent dialog's tool switches (QA B5, filmed at 0:43). A tool the author switches off keeps its
 * row, reads Off, and keeps keyboard focus on its switch, so turning it back on is the same switch
 * rather than a hunt through the full list.
 */
describe("agent dialog tools", () => {
  test("a tool switched off keeps its row, reads Off, and keeps focus on its switch", async () => {
    const studio = mockStudio(TOOLS);
    testing.render(dialog(true));
    const body = testing.within(document.body);
    const toggle = await body.findByTestId("agent-tool-find_in_chapter");
    expect(body.getByTestId("agent-tool-counts-find_in_chapter").textContent).toBe("3 calls · 2 ok · 1 failed");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    studio.hold = true;
    await testing.act(async () => {
      testing.fireEvent.click(toggle);
    });
    // While the save is on its way the switch stays enabled: Chromium moves focus off a focused
    // button the moment it is disabled.
    expect(studio.patches).toEqual([{ disabledTools: ["find_in_chapter"] }]);
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(toggle);
    await testing.act(async () => {
      studio.release();
    });

    await testing.waitFor(() =>
      expect(body.getByTestId("agent-withdrawn-tools").textContent).toBe("Off for this book: find_in_chapter")
    );
    const row = body.getByTestId("agent-tool-find_in_chapter");
    expect(row).toBe(toggle);
    expect(toggle.isConnected).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.closest("li")?.textContent).toContain("Off");
    expect(body.getByTestId("agent-tool-counts-find_in_chapter").textContent).toBe("3 calls · 2 ok · 1 failed");
    expect(document.activeElement).toBe(toggle);
  });

  test("the same switch turns the tool back on", async () => {
    const studio = mockStudio(TOOLS);
    testing.render(dialog(true));
    const body = testing.within(document.body);
    const toggle = await body.findByTestId("agent-tool-find_in_chapter");
    toggle.focus();
    await testing.act(async () => {
      testing.fireEvent.click(toggle);
    });
    await testing.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));

    await testing.act(async () => {
      testing.fireEvent.click(body.getByTestId("agent-tool-find_in_chapter"));
    });
    await testing.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(studio.patches).toEqual([{ disabledTools: ["find_in_chapter"] }, { disabledTools: [] }]);
    expect(toggle.closest("li")?.textContent).toContain("On");
    expect(body.queryByTestId("agent-withdrawn-tools")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  test("a tool that was already off waits behind the full list, and so does one switched off last time", async () => {
    mockStudio([...TOOLS.slice(0, 2), tool("append_to_chapter", "write", 0, 0, false)]);
    const view = testing.render(dialog(true));
    const body = testing.within(document.body);
    const toggle = await body.findByTestId("agent-tool-find_in_chapter");
    expect(body.queryByTestId("agent-tool-append_to_chapter")).toBeNull();
    expect(body.getByTestId("agent-show-all-tools").textContent).toBe("Show all 3 tools");

    await testing.act(async () => {
      testing.fireEvent.click(toggle);
    });
    await testing.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));

    // Closed and opened again, the dialog lists what is on, and the full list holds the rest.
    view.rerender(dialog(false));
    view.rerender(dialog(true));
    await testing.waitFor(() => expect(body.getByTestId("agent-tool-read_chapter")).toBeDefined());
    expect(body.queryByTestId("agent-tool-find_in_chapter")).toBeNull();
    await testing.act(async () => {
      testing.fireEvent.click(body.getByTestId("agent-show-all-tools"));
    });
    expect(body.getByTestId("agent-tool-find_in_chapter").getAttribute("aria-checked")).toBe("false");
    expect(body.getByTestId("agent-tool-append_to_chapter").getAttribute("aria-checked")).toBe("false");
  });
});
