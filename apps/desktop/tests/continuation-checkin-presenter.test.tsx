/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mountDom, unmountDom } from "./support/dom";
import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";

let testing!: typeof import("@testing-library/react/pure");
let ContinuationCheckinPanel!: typeof import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinPanel").ContinuationCheckinPanel;
let ContinuationCheckinResults!: typeof import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinResults").ContinuationCheckinResults;
let readContinuationCheckin!: typeof import("@ai-book-studio/app/lib/continuation-checkin").readContinuationCheckin;
let ContinuationCheckinRefusal!: typeof import("@ai-book-studio/app/lib/continuation-checkin").ContinuationCheckinRefusal;
beforeAll(async () => {
  testing = await mountDom();
  ({ ContinuationCheckinPanel } = await import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinPanel"));
  ({ ContinuationCheckinResults } = await import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinResults"));
  ({ readContinuationCheckin, ContinuationCheckinRefusal } = await import("@ai-book-studio/app/lib/continuation-checkin"));
});
afterEach(() => testing.cleanup());
afterAll(async () => { await unmountDom(); });

const BOOK_ID = "book_abcdef";
const CAMPAIGN_ID = "campaign-synthetic-1";
const HOST_MESSAGES: Record<string, string> = {
  conflict: "The saved continuation changed since it was read. Read it again before checking in.",
  uncertain: "This continuation is only partly present, so it cannot be checked in as complete. Inspect its retained files first.",
  "not-found": "That continuation is not saved for this book.",
  corrupt: "This continuation, its reports, or the coordinator identity belong to another book or do not agree. Nothing was changed.",
  unsupported: "This continuation uses something this build does not understand, so it cannot be checked in.",
  "replan-required": "This continuation was planned with an earlier planner and must be replanned before check-in.",
  "too-large": "This continuation is larger than one coordinator check-in can hold, so it was not split or shortened.",
  "foreign-reference": "The coordinator direction belongs to another run, so this check-in was refused.",
};
const NO_COORDINATOR_MESSAGE =
  "No 037 coordinator run is active in the studio, so there is no run owner or current direction to check this campaign in against. Nothing was changed.";

function checkin(overrides: Partial<ContinuationCheckinInput> = {}): ContinuationCheckinInput {
  return {
    campaignId: CAMPAIGN_ID,
    ownerBookId: BOOK_ID,
    revision: 3,
    planDigest: "a".repeat(64),
    plannedUnionDigest: "b".repeat(64),
    plannerSemantics: "review-campaign-planner-v1",
    manifestHash: "c".repeat(64),
    coordinator: {
      owner: { libraryRegistration: "lib_synthetic", bookId: BOOK_ID, runId: "run_synthetic" },
      direction: {
        kind: "direction",
        owner: { libraryRegistration: "lib_synthetic", bookId: BOOK_ID, runId: "run_synthetic" },
        id: "direction_synthetic",
        revision: 1,
        hash: "d".repeat(64),
      },
    },
    counts: {
      sources: 7, selectedSpans: 11, stages: 5, rangeStages: 3, synthesisStages: 2,
      dependencyEdges: 4, selectedUtf16: 1234, selectedUtf8: 2345, resolvedPlanBytes: 3456, holes: 1,
    },
    segments: { count: 6, bytes: 4567, tokens: 789, unknownBearingSegments: 2 },
    checkpoint: {
      capturedAt: "2026-11-09T00:00:00.000Z", stageCount: 5,
      receipts: { absent: 1, planned: 1, running: 1, completed: 1, incomplete: 1, failed: 0, stopped: 0 },
      completedStageIds: ["stage-a"],
    },
    reports: { owned: 2, foreign: 1, unavailable: 1, total: 4 },
    unknownFieldKeys: { manifest: ["futureField"], counts: [], checkpoint: [] },
    ...overrides,
  };
}

function requiredText(value: string | undefined): string {
  if (value === undefined) throw new Error("Missing synthetic fixture copy");
  return value;
}
function refusal(code: string): InstanceType<typeof ContinuationCheckinRefusal> {
  return new ContinuationCheckinRefusal(code, HOST_MESSAGES[code] ?? "This continuation cannot be checked in as saved.");
}

function body() { return testing.within(document.body); }
function campaignInput(): HTMLInputElement {
  return body().getByTestId("continuation-checkin-campaign-input") as HTMLInputElement;
}
function renderPanel(readCheckin?: (input: ReadContinuationCheckinInput) => Promise<ContinuationCheckinInput>) {
  return testing.render(<ContinuationCheckinPanel bookId={BOOK_ID} {...(readCheckin ? { readCheckin } : {})} />);
}
async function loadCampaign(readCheckin?: (input: ReadContinuationCheckinInput) => Promise<ContinuationCheckinInput>) {
  const view = renderPanel(readCheckin);
  testing.fireEvent.change(campaignInput(), { target: { value: ` ${CAMPAIGN_ID} ` } });
  testing.fireEvent.click(body().getByRole("button", { name: "Load check-in" }));
  return view;
}
function forbiddenText(container: HTMLElement): string {
  return container.textContent ?? "";
}
function expectNoInventedMeasures(container: HTMLElement) {
  const text = forbiddenText(container);
  expect(text).not.toMatch(/\bword\b/i);
  expect(text).not.toMatch(/\bcadence\b/i);
  expect(text).not.toMatch(/\btask\b/i);
  expect(text).not.toMatch(/\brole\b/i);
}

describe("counted payload presentation", () => {
  test("counted payload renders counts verbatim with exact scalar and byte labels", async () => {
    const readCheckin = mock(async (_input: ReadContinuationCheckinInput) => checkin());
    const view = await loadCampaign(readCheckin);
    const counts = await body().findByTestId("continuation-checkin-counts");
    expect(readCheckin).toHaveBeenCalledTimes(1);
    expect(readCheckin.mock.calls[0]?.[0]).toEqual({ bookId: BOOK_ID, campaignId: CAMPAIGN_ID });
    expect(body().getByTestId("continuation-checkin-identity").textContent)
      .toBe(`Campaign ${CAMPAIGN_ID} · Book ${BOOK_ID} · Revision 3`);
    const tallies = body().getByTestId("continuation-checkin-tallies").textContent ?? "";
    for (const fragment of [
      "Sources 7", "Selected spans 11", "Stages 5", "Range stages 3", "Synthesis stages 2",
      "Dependency edges 4", "Selected UTF-16 code units 1,234", "Selected UTF-8 bytes 2,345",
      "Resolved plan bytes 3,456", "Holes 1", "Segments 6", "Segment bytes 4,567",
      "Segment tokens 789", "Segments with retained unknown fields 2",
    ]) expect(tallies).toContain(fragment);
    const checkpoint = body().getByTestId("continuation-checkin-checkpoint").textContent ?? "";
    for (const fragment of ["2026-11-09T00:00:00.000Z", "Stages 5", "Absent 1", "Planned 1",
      "Running 1", "Completed 1", "Incomplete 1", "Failed 0", "Stopped 0", "stage-a"]) {
      expect(checkpoint).toContain(fragment);
    }
    const reports = body().getByTestId("continuation-checkin-reports").textContent ?? "";
    for (const fragment of ["Owned 2", "Foreign 1", "Unavailable 1", "Total 4"]) expect(reports).toContain(fragment);
    expect(counts.textContent).toContain("futureField");
    expect(body().getByRole("button", { name: "Refresh check-in" })).toBeTruthy();
    expectNoInventedMeasures(view.container);
  });

  test("results leaf renders a payload without a checkpoint or reports plainly", () => {
    const view = testing.render(<ContinuationCheckinResults checkin={checkin({ checkpoint: null, reports: null })} />);
    expect(body().getByTestId("continuation-checkin-checkpoint-none").textContent)
      .toBe("No checkpoint is saved for this campaign.");
    expect(body().getByTestId("continuation-checkin-reports-none").textContent)
      .toBe("No disposition reports were resolved for this campaign.");
    expect(body().queryByTestId("continuation-checkin-checkpoint")).toBeNull();
    expect(body().queryByTestId("continuation-checkin-reports")).toBeNull();
    expectNoInventedMeasures(view.container);
  });

  test("editing the campaign identity clears a loaded payload before another load", async () => {
    const readCheckin = mock(async (_input: ReadContinuationCheckinInput) => checkin());
    await loadCampaign(readCheckin);
    await body().findByTestId("continuation-checkin-counts");
    testing.fireEvent.change(campaignInput(), { target: { value: "campaign-other" } });
    expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
    expect(body().getByTestId("continuation-checkin-status").textContent)
      .toContain("Enter a campaign identity");
  });
});

describe("typed refusal presentation", () => {
  test.each([
    ["conflict", "continuation-checkin-refusal-conflict", requiredText(HOST_MESSAGES.conflict)],
    ["uncertain", "continuation-checkin-refusal-uncertain", requiredText(HOST_MESSAGES.uncertain)],
    ["not-found", "continuation-checkin-refusal-not-found", requiredText(HOST_MESSAGES["not-found"])],
    ["corrupt", "continuation-checkin-refusal-corrupt", requiredText(HOST_MESSAGES.corrupt)],
    ["unsupported", "continuation-checkin-refusal-unsupported", "This saved continuation uses something this build does not understand, so it cannot be checked in. Your saved campaign was not changed."],
    ["replan-required", "continuation-checkin-refusal-replan-required", requiredText(HOST_MESSAGES["replan-required"])],
    ["too-large", "continuation-checkin-refusal-too-large", requiredText(HOST_MESSAGES["too-large"])],
    ["foreign-reference", "continuation-checkin-refusal-foreign-reference", requiredText(HOST_MESSAGES["foreign-reference"])],
  ] as const)("refusal %s renders its truthful copy and no counted payload", async (code, testId, copy) => {
    const readCheckin = mock(async (_input: ReadContinuationCheckinInput): Promise<ContinuationCheckinInput> => {
      throw refusal(code);
    });
    const view = await loadCampaign(readCheckin);
    const notice = await body().findByTestId(testId);
    expect(notice.textContent).toBe(copy);
    expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
    expect(campaignInput().value).toBe(` ${CAMPAIGN_ID} `);
    expectNoInventedMeasures(view.container);
  });

  test("production no-coordinator refusal is understandable, plain, and non-crashing", async () => {
    const readCheckin = mock(async (_input: ReadContinuationCheckinInput): Promise<ContinuationCheckinInput> => {
      throw new ContinuationCheckinRefusal("unsupported", NO_COORDINATOR_MESSAGE);
    });
    const view = await loadCampaign(readCheckin);
    const notice = await body().findByTestId("continuation-checkin-no-coordinator");
    expect(notice.textContent).toBe(
      "You need an active coordinator run to check in, and none is active in this studio. Your saved campaign was not changed."
    );
    expect(notice.textContent).not.toContain("037");
    expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
    expect(body().getByRole("button", { name: "Load check-in" })).toBeTruthy();
    expectNoInventedMeasures(view.container);
  });

  test("an unlisted refusal code falls back to a plain saved-state message", async () => {
    const readCheckin = mock(async (_input: ReadContinuationCheckinInput): Promise<ContinuationCheckinInput> => {
      throw new ContinuationCheckinRefusal("synthetic-future-code", "Synthetic host detail that stays local to the host.");
    });
    await loadCampaign(readCheckin);
    const notice = await body().findByTestId("continuation-checkin-refusal");
    expect(notice.textContent).toBe(
      "This continuation cannot be checked in as saved. Your saved continuation was not changed."
    );
    expect(notice.textContent).not.toContain("Synthetic host detail");
    expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
  });

  test("the default client keeps the typed code when the host seam refuses", async () => {
    const host = window as unknown as { studio?: unknown };
    const previous = host.studio;
    host.studio = {
      continuation: {
        checkin: async () => ({ ok: false, error: { code: "conflict", message: HOST_MESSAGES.conflict } }),
      },
    };
    try {
      await expect(readContinuationCheckin({ bookId: BOOK_ID, campaignId: CAMPAIGN_ID }))
        .rejects.toMatchObject({ code: "conflict", message: HOST_MESSAGES.conflict });
    } finally {
      host.studio = previous;
    }
  });

  test("the mounted default path shows the no-coordinator state when no seam exists", async () => {
    const host = window as unknown as { studio?: unknown };
    const previous = host.studio;
    host.studio = {};
    try {
      const view = renderPanel();
      testing.fireEvent.change(campaignInput(), { target: { value: CAMPAIGN_ID } });
      testing.fireEvent.click(body().getByRole("button", { name: "Load check-in" }));
      const notice = await body().findByTestId("continuation-checkin-no-coordinator");
      expect(notice.textContent).toContain("active coordinator run");
      expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
      expectNoInventedMeasures(view.container);
    } finally {
      host.studio = previous;
    }
  });
});
