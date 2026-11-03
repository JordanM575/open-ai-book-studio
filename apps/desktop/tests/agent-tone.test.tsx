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

function statusFixture(overrides?: Partial<AgentStatus>): AgentStatus {
  return {
    tools: [],
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
    plugins: { folder: null, loaded: [], tools: [], failures: [] },
    ...overrides
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
          tone: typeof patch.tone === "string" ? patch.tone : current.tone,
          answerLength:
            patch.answerLength === "brief" || patch.answerLength === "detailed" ? patch.answerLength : current.answerLength
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
 * Spec 031 T010: author-visible tone and answer-length controls. The dialog
 * shows the stored values, saves a new tone, clears it back to empty, changes
 * the answer length, and discloses that both travel with every sent turn.
 */
describe("agent tone and answer length", () => {
  test("shows the stored values and the disclosure", async () => {
    mockStudio(statusFixture({ tone: "Plainspoken.", answerLength: "brief" }), () => {});
    const body = renderDialog();
    const tone = (await body.findByTestId("agent-tone")) as HTMLInputElement;
    expect(tone.value).toBe("Plainspoken.");
    expect((body.getByTestId("agent-answer-length") as HTMLSelectElement).value).toBe("brief");
    expect(body.getByText(/travel with every turn you send/i)).toBeDefined();
  });

  test("saving a tone sends only the tone patch", async () => {
    const patches: Record<string, unknown>[] = [];
    mockStudio(statusFixture(), (patch) => {
      patches.push(patch);
    });
    const body = renderDialog();
    const tone = (await body.findByTestId("agent-tone")) as HTMLInputElement;
    testing.fireEvent.change(tone, { target: { value: "Dry humor." } });
    testing.fireEvent.click(body.getByTestId("agent-tone-save"));
    await testing.waitFor(() => expect(patches).toEqual([{ tone: "Dry humor." }]));
    expect((body.getByTestId("agent-tone") as HTMLInputElement).value).toBe("Dry humor.");
  });

  test("clearing resets the tone to empty", async () => {
    const patches: Record<string, unknown>[] = [];
    mockStudio(statusFixture({ tone: "Plainspoken." }), (patch) => {
      patches.push(patch);
    });
    const body = renderDialog();
    await body.findByTestId("agent-tone");
    testing.fireEvent.click(body.getByTestId("agent-tone-clear"));
    await testing.waitFor(() => expect(patches).toEqual([{ tone: "" }]));
  });

  test("changing the answer length sends only that patch", async () => {
    const patches: Record<string, unknown>[] = [];
    mockStudio(statusFixture(), (patch) => {
      patches.push(patch);
    });
    const body = renderDialog();
    const select = (await body.findByTestId("agent-answer-length")) as HTMLSelectElement;
    testing.fireEvent.change(select, { target: { value: "detailed" } });
    await testing.waitFor(() => expect(patches).toEqual([{ answerLength: "detailed" }]));
  });
});
