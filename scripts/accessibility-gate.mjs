/**
 * Pure gate logic for the T016 accessibility check (spec 012). Imported by both the Playwright
 * driver (`scripts/accessibility-check.mjs`) and the committed unit tests, so the fail/report
 * split is tested without launching a browser.
 */

/** Impacts that fail the gate; everything else is reported, never gated. */
export const FAILING_IMPACTS = ["critical", "serious"];

export function summarizeAxe(violations) {
  const list = violations ?? [];
  return {
    failing: list.filter((violation) => FAILING_IMPACTS.includes(violation.impact ?? "")),
    reported: list.filter((violation) => !FAILING_IMPACTS.includes(violation.impact ?? ""))
  };
}
