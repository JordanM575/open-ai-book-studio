/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mountDom, unmountDom } from "./support/dom";
import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";

/*
 * Seam 6d (039 T019) measurement for the continuation check-in presenter.
 *
 * Accessibility is measured here at DOM level (roles, labels, focus order,
 * aria associations, design-token usage) plus axe-core's structural rules,
 * following the repo's existing happy-dom pattern in format-matter.test.tsx:
 * happy-dom has no layout, so contrast ratios and target sizes stay with the
 * browser checks. The only browser a11y gate in the repo
 * (scripts/accessibility-check.mjs) walks the built web app; there the panel
 * is reachable only in its idle state inside the workspace view, which that
 * gate already scans. The counted and refusal states below are reachable
 * only through the injectable reader in tests — they are labelled as such
 * and are not a production connected journey: in production wiring the
 * journey ends at the no-coordinator refusal, which is also measured here
 * through the default client with no host seam.
 *
 * Fidelity is measured by rendering a matrix of synthetic codec payloads and
 * comparing the rendered counts and labels against hardcoded expected
 * strings (formatted by hand, not through the presenter's own formatter).
 */
let testing!: typeof import("@testing-library/react/pure");
let axe!: typeof import("axe-core");
let ContinuationCheckinPanel!: typeof import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinPanel").ContinuationCheckinPanel;
let ContinuationCheckinResults!: typeof import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinResults").ContinuationCheckinResults;
let ContinuationCheckinRefusal!: typeof import("@ai-book-studio/app/lib/continuation-checkin").ContinuationCheckinRefusal;
beforeAll(async () => {
  testing = await mountDom();
  axe = (await import("axe-core")).default;
  ({ ContinuationCheckinPanel } = await import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinPanel"));
  ({ ContinuationCheckinResults } = await import("@ai-book-studio/app/components/continuation-checkin/ContinuationCheckinResults"));
  ({ ContinuationCheckinRefusal } = await import("@ai-book-studio/app/lib/continuation-checkin"));
});
afterEach(() => testing.cleanup());
afterAll(async () => { await unmountDom(); });

const BOOK_ID = "book_abcdef";
const CAMPAIGN_ID = "campaign-synthetic-1";
const NO_COORDINATOR_MESSAGE =
  "No 037 coordinator run is active in the studio, so there is no run owner or current direction to check this campaign in against. Nothing was changed.";

// The structural rule set the repo already gates on in happy-dom
// (format-matter.test.tsx); contrast/target-size rules need a real layout.
const STRUCTURAL_RULES = [
  "label", "button-name", "select-name", "list", "listitem", "aria-allowed-attr",
  "aria-required-attr", "aria-valid-attr", "aria-valid-attr-value", "duplicate-id-aria",
  "form-field-multiple-labels", "nested-interactive",
];

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

function body() { return testing.within(document.body); }
function campaignInput(): HTMLInputElement {
  return body().getByTestId("continuation-checkin-campaign-input") as HTMLInputElement;
}
async function loadWith(readCheckin: (input: ReadContinuationCheckinInput) => Promise<ContinuationCheckinInput>) {
  const view = testing.render(<ContinuationCheckinPanel bookId={BOOK_ID} readCheckin={readCheckin} />);
  testing.fireEvent.change(campaignInput(), { target: { value: CAMPAIGN_ID } });
  testing.fireEvent.click(body().getByRole("button", { name: "Load check-in" }));
  return view;
}
function expectNoInventedMeasures(container: HTMLElement) {
  const text = container.textContent ?? "";
  expect(text).not.toMatch(/\bword\b/i);
  expect(text).not.toMatch(/\bcadence\b/i);
  expect(text).not.toMatch(/\btask\b/i);
  expect(text).not.toMatch(/\brole\b/i);
}
async function expectNoStructuralViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "rule", values: STRUCTURAL_RULES },
  });
  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(" | ")}`)
  ).toEqual([]);
  expect(results.passes.length).toBeGreaterThan(3);
}

describe("accessibility of the mounted presenter (DOM level, happy-dom)", () => {
  test("idle state: labelled section, labelled field, polite status, no structural violations", async () => {
    const view = testing.render(<ContinuationCheckinPanel bookId={BOOK_ID} readCheckin={mock(async () => checkin())} />);
    const panel = view.container.querySelector('[data-testid="continuation-checkin-panel"]') as HTMLElement;
    const headingId = panel.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    const heading = view.container.querySelector(`#${CSS.escape(headingId ?? "")}`);
    expect(heading?.tagName).toBe("H2");
    expect(heading?.textContent).toBe("Continuation check-in");
    expect(body().getByRole("heading", { name: "Continuation check-in" })).toBeTruthy();
    const input = body().getByLabelText("Campaign identity") as HTMLInputElement;
    expect(input).toBe(campaignInput());
    expect(input.labels?.length).toBe(1);
    expect(body().getByRole("button", { name: "Load check-in" }).hasAttribute("disabled")).toBe(true);
    const status = body().getByTestId("continuation-checkin-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect((status as HTMLElement).tabIndex).toBe(-1);
    await expectNoStructuralViolations(view.container);
    expectNoInventedMeasures(view.container);
  });

  test("token usage: glass surface, ring focus token, no raw colour or invented shadow/motion classes", () => {
    const view = testing.render(<ContinuationCheckinPanel bookId={BOOK_ID} readCheckin={mock(async () => checkin())} />);
    const panel = view.container.querySelector('[data-testid="continuation-checkin-panel"]') as HTMLElement;
    expect(panel.className).toContain("glass");
    expect(panel.className).toContain("rounded-[var(--corner-lg)]");
    const status = body().getByTestId("continuation-checkin-status");
    expect(status.className).toContain("focus-visible:outline-[var(--ring)]");
    for (const element of view.container.querySelectorAll("[class]")) {
      const classes = element.getAttribute("class") ?? "";
      expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(classes).not.toMatch(/\brgb\(|\brgba\(|\bhsl\(/);
      // The shared Button brings its own token motion/elevation; the presenter
      // surface itself must add no animation or transition of its own.
      if (element.tagName !== "BUTTON") expect(classes).not.toMatch(/\banimate-|\btransition\b/);
    }
    const loadButton = body().getByRole("button", { name: "Load check-in" });
    expect(loadButton.className).toContain("duration-[var(--duration-fast)]");
    expect(loadButton.className).toContain("shadow-[var(--elevation-1)]");
  });

  test("counted state (injected reader, test-only): focus lands on the status and tab order is document order", async () => {
    const view = await loadWith(mock(async () => checkin()));
    await body().findByTestId("continuation-checkin-counts");
    const status = body().getByTestId("continuation-checkin-status");
    expect(document.activeElement).toBe(status);
    const counts = body().getByTestId("continuation-checkin-counts");
    expect(counts.getAttribute("aria-label")).toBe("Counted check-in inputs");
    expect(counts.className).toContain("border-[var(--border)]");
    // happy-dom reports no native tabIndex for <summary>, so focus order is
    // measured as document order of the natively focusable controls here;
    // real Tab traversal stays with the browser checks.
    const tabbables = [...view.container.querySelectorAll<HTMLElement>("input, button, summary")]
      .filter((element) => !element.hasAttribute("disabled"));
    expect(tabbables.map((element) => element.getAttribute("data-testid") ?? element.textContent?.trim())).toEqual([
      "continuation-checkin-campaign-input",
      "continuation-checkin-load",
      "Inspect saved record digests",
      "Inspect retained field names this build keeps without reading",
    ]);
    for (const summary of view.container.querySelectorAll("summary")) {
      expect(summary.parentElement?.tagName).toBe("DETAILS");
    }
    for (const element of view.container.querySelectorAll<HTMLElement>("[tabindex]")) {
      expect(element.tabIndex).toBeLessThanOrEqual(0);
    }
    const summaries = [...view.container.querySelectorAll("summary")];
    for (const summary of summaries) expect(summary.className).toContain("min-h-11");
    await expectNoStructuralViolations(view.container);
    expectNoInventedMeasures(view.container);
  });

  test("counted state without checkpoint or reports (injected reader, test-only) has no structural violations", async () => {
    const view = await loadWith(mock(async () => checkin({ checkpoint: null, reports: null })));
    await body().findByTestId("continuation-checkin-counts");
    expect(body().getByTestId("continuation-checkin-checkpoint-none")).toBeTruthy();
    await expectNoStructuralViolations(view.container);
  });

  test("production no-coordinator refusal (default client, no host seam) is a polite labelled state with no structural violations", async () => {
    const host = window as unknown as { studio?: unknown };
    const previous = host.studio;
    host.studio = {};
    try {
      const view = testing.render(<ContinuationCheckinPanel bookId={BOOK_ID} />);
      testing.fireEvent.change(campaignInput(), { target: { value: CAMPAIGN_ID } });
      testing.fireEvent.click(body().getByRole("button", { name: "Load check-in" }));
      const notice = await body().findByTestId("continuation-checkin-no-coordinator");
      expect(notice.getAttribute("role")).toBe("status");
      expect(notice.getAttribute("aria-live")).toBe("polite");
      expect(document.activeElement).toBe(notice);
      expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
      // The author can recover without a pointer: the field and the button stay reachable.
      expect((campaignInput() as HTMLInputElement).disabled).toBe(false);
      expect(body().getByRole("button", { name: "Load check-in" }).hasAttribute("disabled")).toBe(false);
      await expectNoStructuralViolations(view.container);
      expectNoInventedMeasures(view.container);
    } finally {
      host.studio = previous;
    }
  });

  test("typed refusal state (injected reader, test-only) keeps the status semantics and no structural violations", async () => {
    const view = await loadWith(mock(async (): Promise<ContinuationCheckinInput> => {
      throw new ContinuationCheckinRefusal("uncertain", "This continuation is only partly present.");
    }));
    const notice = await body().findByTestId("continuation-checkin-refusal-uncertain");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(body().queryByTestId("continuation-checkin-counts")).toBeNull();
    await expectNoStructuralViolations(view.container);
    expectNoInventedMeasures(view.container);
  });

  test("no-coordinator copy stays free of internal spec numbers in every reachable refusal presentation", async () => {
    const view = await loadWith(mock(async (): Promise<ContinuationCheckinInput> => {
      throw new ContinuationCheckinRefusal("unsupported", NO_COORDINATOR_MESSAGE);
    }));
    const notice = await body().findByTestId("continuation-checkin-no-coordinator");
    expect(notice.textContent).not.toMatch(/\b0\d\d\b/);
    expect(notice.textContent).toContain("Your saved campaign was not changed.");
    await expectNoStructuralViolations(view.container);
  });
});

describe("fidelity: rendered counts are byte-faithful to the codec payload (synthetic matrix)", () => {
  function renderLeaf(payload: ContinuationCheckinInput) {
    const view = testing.render(<ContinuationCheckinResults checkin={payload} />);
    return {
      view,
      identity: body().getByTestId("continuation-checkin-identity").textContent ?? "",
      tallies: body().getByTestId("continuation-checkin-tallies").textContent ?? "",
    };
  }

  test("zero counts render as zeros, with plain none states for empty stage and field lists", () => {
    const { view, identity, tallies } = renderLeaf(checkin({
      revision: 1,
      counts: {
        sources: 0, selectedSpans: 0, stages: 0, rangeStages: 0, synthesisStages: 0,
        dependencyEdges: 0, selectedUtf16: 0, selectedUtf8: 0, resolvedPlanBytes: 0, holes: 0,
      },
      segments: { count: 0, bytes: 0, tokens: 0, unknownBearingSegments: 0 },
      checkpoint: {
        capturedAt: "2026-11-09T01:02:03.000Z", stageCount: 0,
        receipts: { absent: 0, planned: 0, running: 0, completed: 0, incomplete: 0, failed: 0, stopped: 0 },
        completedStageIds: [],
      },
      reports: { owned: 0, foreign: 0, unavailable: 0, total: 0 },
      unknownFieldKeys: { manifest: [], counts: [], checkpoint: [] },
    }));
    expect(identity).toBe(`Campaign ${CAMPAIGN_ID} · Book ${BOOK_ID} · Revision 1`);
    for (const fragment of [
      "Sources 0", "Selected spans 0", "Stages 0", "Range stages 0", "Synthesis stages 0",
      "Dependency edges 0", "Selected UTF-16 code units 0", "Selected UTF-8 bytes 0",
      "Resolved plan bytes 0", "Holes 0", "Segments 0", "Segment bytes 0", "Segment tokens 0",
      "Segments with retained unknown fields 0",
    ]) expect(tallies).toContain(fragment);
    const checkpoint = body().getByTestId("continuation-checkin-checkpoint").textContent ?? "";
    expect(checkpoint).toContain("Checkpoint captured 2026-11-09T01:02:03.000Z · Stages 0");
    expect(checkpoint).toContain("Completed stages None");
    for (const fragment of ["Absent 0", "Planned 0", "Running 0", "Completed 0", "Incomplete 0", "Failed 0", "Stopped 0"]) {
      expect(checkpoint).toContain(fragment);
    }
    expect(body().getByTestId("continuation-checkin-reports").textContent)
      .toContain("Reports · Owned 0 · Foreign 0 · Unavailable 0 · Total 0");
    const whole = view.container.textContent ?? "";
    expect(whole).toContain("Manifest fields None");
    expect(whole).toContain("Saved counts fields None");
    expect(whole).toContain("Checkpoint fields None");
    expectNoInventedMeasures(view.container);
  });

  test("large counts render with the exact grouped formatting, hardcoded here as the oracle", () => {
    const { identity, tallies } = renderLeaf(checkin({
      revision: 12345,
      counts: {
        sources: 64, selectedSpans: 123456, stages: 48, rangeStages: 32, synthesisStages: 16,
        dependencyEdges: 98765, selectedUtf16: 9876543, selectedUtf8: 12345678,
        resolvedPlanBytes: 1234567, holes: 1234,
      },
      segments: { count: 4096, bytes: 98765432, tokens: 3456789, unknownBearingSegments: 4096 },
      checkpoint: {
        capturedAt: "2026-11-09T23:59:59.000Z", stageCount: 48,
        receipts: { absent: 1000, planned: 2000, running: 3, completed: 40000, incomplete: 50, failed: 6, stopped: 7 },
        completedStageIds: ["stage-a", "stage-b", "stage-c"],
      },
      reports: { owned: 10000, foreign: 2345, unavailable: 678, total: 13023 },
    }));
    expect(identity).toBe(`Campaign ${CAMPAIGN_ID} · Book ${BOOK_ID} · Revision 12,345`);
    for (const fragment of [
      "Sources 64", "Selected spans 123,456", "Stages 48", "Range stages 32", "Synthesis stages 16",
      "Dependency edges 98,765", "Selected UTF-16 code units 9,876,543", "Selected UTF-8 bytes 12,345,678",
      "Resolved plan bytes 1,234,567", "Holes 1,234", "Segments 4,096", "Segment bytes 98,765,432",
      "Segment tokens 3,456,789", "Segments with retained unknown fields 4,096",
    ]) expect(tallies).toContain(fragment);
    const checkpoint = body().getByTestId("continuation-checkin-checkpoint").textContent ?? "";
    for (const fragment of [
      "Checkpoint captured 2026-11-09T23:59:59.000Z · Stages 48", "Absent 1,000", "Planned 2,000",
      "Running 3", "Completed 40,000", "Incomplete 50", "Failed 6", "Stopped 7",
      "Completed stages stage-a · stage-b · stage-c",
    ]) expect(checkpoint).toContain(fragment);
    expect(body().getByTestId("continuation-checkin-reports").textContent)
      .toContain("Reports · Owned 10,000 · Foreign 2,345 · Unavailable 678 · Total 13,023");
  });

  test("unknown-bearing segments and retained field names render verbatim, in payload order", () => {
    const { view, tallies } = renderLeaf(checkin({
      segments: { count: 4, bytes: 10, tokens: 11, unknownBearingSegments: 4 },
      unknownFieldKeys: {
        manifest: ["futureManifestField", "anotherFutureField"],
        counts: ["futureCountsField"],
        checkpoint: ["futureCheckpointField"],
      },
    }));
    expect(tallies).toContain("Segments with retained unknown fields 4");
    const whole = view.container.textContent ?? "";
    expect(whole).toContain("Manifest fields futureManifestField · anotherFutureField");
    expect(whole).toContain("Saved counts fields futureCountsField");
    expect(whole).toContain("Checkpoint fields futureCheckpointField");
    expect(whole).toContain(`Plan digest ${"a".repeat(64)}`);
    expect(whole).toContain(`Planned union digest ${"b".repeat(64)}`);
    expect(whole).toContain(`Manifest hash ${"c".repeat(64)}`);
    expect(whole).toContain("Planner review-campaign-planner-v1");
    expectNoInventedMeasures(view.container);
  });

  test("checkpoint and reports render independently: each may be present while the other is absent", () => {
    const withCheckpoint = renderLeaf(checkin({ reports: null }));
    expect(body().getByTestId("continuation-checkin-checkpoint")).toBeTruthy();
    expect(body().getByTestId("continuation-checkin-reports-none").textContent)
      .toBe("No disposition reports were resolved for this campaign.");
    expectNoInventedMeasures(withCheckpoint.view.container);
    testing.cleanup();
    const withReports = renderLeaf(checkin({ checkpoint: null }));
    expect(body().getByTestId("continuation-checkin-checkpoint-none").textContent)
      .toBe("No checkpoint is saved for this campaign.");
    expect(body().getByTestId("continuation-checkin-reports").textContent)
      .toContain("Reports · Owned 2 · Foreign 1 · Unavailable 1 · Total 4");
    // With no checkpoint, its retained-field list is the plain none state, not invented data.
    expect(withReports.view.container.textContent).toContain("Checkpoint fields None");
    expectNoInventedMeasures(withReports.view.container);
  });

  test("inconsistent tallies are shown as saved, never recounted or corrected by the presenter", () => {
    // Stages 10 with range 3 + synthesis 2 does not add up; the presenter must
    // copy the record, not repair it. The same holds for a reports total that
    // disagrees with its parts at this leaf (the host mapper refuses such a
    // payload upstream; the leaf still counts nothing itself).
    const { tallies } = renderLeaf(checkin({
      counts: {
        sources: 9, selectedSpans: 9, stages: 10, rangeStages: 3, synthesisStages: 2,
        dependencyEdges: 9, selectedUtf16: 9, selectedUtf8: 9, resolvedPlanBytes: 9, holes: 9,
      },
    }));
    expect(tallies).toContain("Stages 10 · Range stages 3 · Synthesis stages 2");
  });

  test("the panel path renders the matrix payload byte-faithfully as well (injected reader, test-only)", async () => {
    const payload = checkin({
      revision: 987654,
      counts: {
        sources: 1, selectedSpans: 2, stages: 3, rangeStages: 4, synthesisStages: 5,
        dependencyEdges: 6, selectedUtf16: 7654321, selectedUtf8: 8765432,
        resolvedPlanBytes: 654321, holes: 0,
      },
      segments: { count: 1, bytes: 2, tokens: 3, unknownBearingSegments: 1 },
      checkpoint: null,
      reports: null,
    });
    const view = await loadWith(mock(async () => payload));
    await body().findByTestId("continuation-checkin-counts");
    expect(body().getByTestId("continuation-checkin-identity").textContent)
      .toBe(`Campaign ${CAMPAIGN_ID} · Book ${BOOK_ID} · Revision 987,654`);
    const tallies = body().getByTestId("continuation-checkin-tallies").textContent ?? "";
    for (const fragment of [
      "Selected UTF-16 code units 7,654,321", "Selected UTF-8 bytes 8,765,432",
      "Resolved plan bytes 654,321", "Holes 0", "Segments with retained unknown fields 1",
    ]) expect(tallies).toContain(fragment);
    expect(body().getByTestId("continuation-checkin-checkpoint-none")).toBeTruthy();
    expect(body().getByTestId("continuation-checkin-reports-none")).toBeTruthy();
    expectNoInventedMeasures(view.container);
  });
});
