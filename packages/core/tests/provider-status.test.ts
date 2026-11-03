import { describe, expect, test } from "bun:test";
import { providerStatus, type ProviderStatusInput } from "../src/providers/status";

const CHECKED_AT = "2026-10-26T00:00:00.000Z";
const SECRET = "sk-testsecretvalue0123456789";

describe("providerStatus", () => {
  test("maps all six connection states from configuration and the last check", () => {
    const cases: Array<{ input: ProviderStatusInput; state: string }> = [
      { input: { configured: true, lastCheck: { status: "success", checkedAt: CHECKED_AT } }, state: "connected" },
      { input: { configured: false }, state: "not-set-up" },
      {
        input: {
          configured: true,
          lastCheck: { status: "failure", checkedAt: CHECKED_AT, error: { code: "auth", message: `Rejected ${SECRET}` } }
        },
        state: "key-rejected"
      },
      {
        input: {
          configured: true,
          lastCheck: { status: "failure", checkedAt: CHECKED_AT, error: { code: "quota", message: `Limit ${SECRET}` } }
        },
        state: "limited"
      },
      {
        input: {
          configured: true,
          lastCheck: {
            status: "failure",
            checkedAt: CHECKED_AT,
            error: { code: "permission", message: `Scopes ${SECRET}` }
          }
        },
        state: "needs-permission"
      },
      {
        input: {
          configured: true,
          lastCheck: { status: "failure", checkedAt: CHECKED_AT, error: { code: "offline", message: `Offline ${SECRET}` } }
        },
        state: "unavailable"
      }
    ];

    for (const { input, state } of cases) {
      const result = providerStatus(input);
      expect(result.state).toBe(state);
      expect(result.message).not.toContain(SECRET);
      expect(result.action.safe).toBe(true);
    }
  });

  test("preserves the redacted provider message and omits stack frames", () => {
    const result = providerStatus({
      configured: true,
      lastCheck: {
        status: "failure",
        checkedAt: CHECKED_AT,
        error: {
          code: "auth",
          message: `Error: The provider rejected ${SECRET}.\n    at sendRequest (provider.js:12:3)`
        }
      }
    });

    expect(result.message).toContain("The provider rejected sk-[redacted]");
    expect(result.message).not.toContain(SECRET);
    expect(result.message).not.toContain("sendRequest");
    expect(result.checkedAt).toBe(CHECKED_AT);
  });

  test("a configured connection with no successful check is unavailable", () => {
    const result = providerStatus({ configured: true, lastCheck: null });

    expect(result).toMatchObject({ state: "unavailable", checkedAt: null, severity: "warning" });
    expect(result.action.id).toBe("check-connection");
  });
});
