import { describe, expect, test } from "bun:test";
import {
  HEALTH_SEVERITIES,
  HEALTH_SEVERITY_COPY,
  LOCATION_HEALTH_COPY,
  LOCATION_HEALTH_STATES,
  PROVIDER_STATUS_COPY,
  PROVIDER_STATUS_STATES
} from "../src/health/copy";

describe("integration health copy", () => {
  test("every location and provider state has sentence copy and a safe action", () => {
    for (const state of LOCATION_HEALTH_STATES) {
      const copy = LOCATION_HEALTH_COPY[state];
      expect(copy.label.trim()).not.toBe("");
      expect(copy.message(2).trim()).not.toBe("");
      expect(copy.action.label.trim()).not.toBe("");
      expect(copy.action.safe).toBe(true);
      expect(HEALTH_SEVERITIES).toContain(copy.severity);
    }

    for (const state of PROVIDER_STATUS_STATES) {
      const copy = PROVIDER_STATUS_COPY[state];
      expect(copy.label.trim()).not.toBe("");
      expect(copy.message(0).trim()).not.toBe("");
      expect(copy.action.label.trim()).not.toBe("");
      expect(copy.action.safe).toBe(true);
      expect(HEALTH_SEVERITIES).toContain(copy.severity);
    }
  });

  test("every severity has its complete label, icon and explanation", () => {
    for (const severity of HEALTH_SEVERITIES) {
      const copy = HEALTH_SEVERITY_COPY[severity];
      expect(copy.label.trim()).not.toBe("");
      expect(copy.icon.trim()).not.toBe("");
      expect(copy.message.trim()).not.toBe("");
    }
  });

  test("copy is controlled and does not contain raw error text", () => {
    const allCopy = [
      ...LOCATION_HEALTH_STATES.map((state) => LOCATION_HEALTH_COPY[state].message(2)),
      ...PROVIDER_STATUS_STATES.map((state) => PROVIDER_STATUS_COPY[state].message(0)),
      ...HEALTH_SEVERITIES.map((severity) => HEALTH_SEVERITY_COPY[severity].message)
    ].join(" ");

    expect(allCopy).not.toContain("Error:");
    expect(allCopy).not.toContain("stack trace");
    expect(allCopy).not.toContain("sk-test");
  });
});
