/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { AgentStatus } from "@ai-book-studio/core/agent/metrics";
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

function spendingFixture(overrides?: Partial<AgentStatus["spending"]>): AgentStatus["spending"] {
  return {
    perTurnCeilingUsd: null,
    monthlyWarningUsd: null,
    monthToDateUsd: 0,
    monthUnknownCostTurns: 0,
    lastTurnWarning: null,
    monthlyWarning: null,
    ...overrides
  };
}

function statusFixture(spending: AgentStatus["spending"]): AgentStatus {
  return {
    tools: [],
    toolTotals: { tools: [], calls: 0, failures: 0 },
    tone: "",
    answerLength: "standard",
    spending,
    skills: { present: false, enabled: true, characters: 0 },
    cache: { cachedInputTokens: 0, freshInputTokens: 0, hitRate: null, turnsWithCache: 0, turns: 0, mode: "auto" },
    plugins: { folder: null, loaded: [], tools: [], failures: [] }
  };
}

function mockStudio(status: AgentStatus, onPatch: (patch: Record<string, unknown>) => void) {
  let current = status;
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    agent: {
      status: mock(async () => ({ ok: true, data: current })),
      setSettings: mock(async (_bookId: string, patch: Record<string, unknown>) => {
        onPatch(patch);
        current = {
          ...current,
          spending: {
            ...current.spending,
            ...(typeof patch.perTurnCeilingUsd === "number" || patch.perTurnCeilingUsd === null
              ? { perTurnCeilingUsd: patch.perTurnCeilingUsd }
              : {}),
            ...(typeof patch.monthlyWarningUsd === "number" || patch.monthlyWarningUsd === null
              ? { monthlyWarningUsd: patch.monthlyWarningUsd }
              : {})
          }
        };
        return { ok: true, data: current };
      }),
      bridge: mock(async () => ({ ok: true, data: { running: false, url: null, token: null } }))
    }
  };
}

function renderDialog() {
  testing.render(
    React.createElement(AgentDialog, { open: true, bookId: "book_test0001", onClose: () => {}, onNotice: () => {} })
  );
  return testing.within(document.body);
}

/**
 * Spec 011 T036: the spending hooks. The dialog shows the month spend with its lower-bound
 * note, saves dollar limits, refuses non-positive input, renders warnings, and clears back
 * to unset. Warnings stay display-only: nothing here blocks a turn.
 */
describe("agent spending hooks", () => {
  test("shows the month spend and empty limits when unset", async () => {
    mockStudio(statusFixture(spendingFixture({ monthToDateUsd: 4.2 })), () => {});
    const body = renderDialog();
    await body.findByText("Spent $4.20 so far this month.");
    expect(body.getByTestId("agent-spending-month").textContent).toBe("Spent $4.20 so far this month.");
    expect((body.getByTestId("agent-spending-per-turn") as HTMLInputElement).value).toBe("");
    expect((body.getByTestId("agent-spending-monthly") as HTMLInputElement).value).toBe("");
    expect((body.getByTestId("agent-spending-save") as HTMLButtonElement).disabled).toBe(true);
    expect(body.getByText(/a warning never stops the agent/i)).toBeDefined();
  });

  test("qualifies the month total when turns went unpriced", async () => {
    mockStudio(statusFixture(spendingFixture({ monthToDateUsd: 4.2, monthUnknownCostTurns: 2 })), () => {});
    const body = renderDialog();
    await body.findByText(/Spent at least \$4\.20 so far this month/);
    expect(body.getByTestId("agent-spending-month").textContent).toBe(
      "Spent at least $4.20 so far this month: 2 turns did not report a cost."
    );
  });

  test("saving limits sends the dollar patch", async () => {
    const patches: Record<string, unknown>[] = [];
    mockStudio(statusFixture(spendingFixture()), (patch) => {
      patches.push(patch);
    });
    const body = renderDialog();
    const perTurn = (await body.findByTestId("agent-spending-per-turn")) as HTMLInputElement;
    testing.fireEvent.change(perTurn, { target: { value: "5" } });
    testing.fireEvent.change(body.getByTestId("agent-spending-monthly"), { target: { value: "20" } });
    testing.fireEvent.click(body.getByTestId("agent-spending-save"));
    await testing.waitFor(() =>
      expect(patches).toEqual([{ perTurnCeilingUsd: 5, monthlyWarningUsd: 20 }])
    );
    expect((body.getByTestId("agent-spending-per-turn") as HTMLInputElement).value).toBe("5");
    expect((body.getByTestId("agent-spending-monthly") as HTMLInputElement).value).toBe("20");
  });

  test("non-positive input keeps the save disabled", async () => {
    mockStudio(statusFixture(spendingFixture()), () => {});
    const body = renderDialog();
    const perTurn = (await body.findByTestId("agent-spending-per-turn")) as HTMLInputElement;
    testing.fireEvent.change(perTurn, { target: { value: "-3" } });
    expect((body.getByTestId("agent-spending-save") as HTMLButtonElement).disabled).toBe(true);
  });

  test("renders the per-turn and monthly warnings", async () => {
    mockStudio(
      statusFixture(
        spendingFixture({
          lastTurnWarning: { level: "reached", message: "This turn cost $12.00 — over its $10.00 per-turn limit." },
          monthlyWarning: { level: "approaching", message: "This book has used $8.00 of its $10.00 monthly warning level." }
        })
      ),
      () => {}
    );
    const body = renderDialog();
    const warnings = await body.findByTestId("agent-spending-warnings");
    expect(warnings.textContent).toContain("over its $10.00 per-turn limit");
    expect(warnings.textContent).toContain("monthly warning level");
  });

  test("clearing sends nulls for both limits", async () => {
    const patches: Record<string, unknown>[] = [];
    mockStudio(statusFixture(spendingFixture({ perTurnCeilingUsd: 5, monthlyWarningUsd: 20 })), (patch) => {
      patches.push(patch);
    });
    const body = renderDialog();
    await body.findByTestId("agent-spending-clear");
    testing.fireEvent.click(body.getByTestId("agent-spending-clear"));
    await testing.waitFor(() =>
      expect(patches).toEqual([{ perTurnCeilingUsd: null, monthlyWarningUsd: null }])
    );
  });
});
