import {
  PROVIDER_STATUS_COPY,
  type HealthActionCopy,
  type HealthSeverity,
  type ProviderStatusState
} from "../health/copy";
import { redact } from "./redact";
import type { ProviderErrorCode } from "./types";

export type ProviderLastCheck =
  | { status: "success"; checkedAt: string }
  | { status: "failure"; checkedAt: string; error: { code: ProviderErrorCode; message: string } };

export interface ProviderStatusInput {
  configured: boolean;
  lastCheck?: ProviderLastCheck | null;
}

export interface ProviderStatus {
  state: ProviderStatusState;
  label: string;
  severity: HealthSeverity;
  message: string;
  action: HealthActionCopy;
  checkedAt: string | null;
}

/** Map a connection's last check to author-facing status without exposing secrets or stack traces. */
export function providerStatus(input: ProviderStatusInput): ProviderStatus {
  let state: ProviderStatusState;

  if (!input.configured) {
    state = "not-set-up";
  } else if (!input.lastCheck) {
    state = "unavailable";
  } else if (input.lastCheck.status === "success") {
    state = "connected";
  } else {
    switch (input.lastCheck.error.code) {
      case "auth":
        state = "key-rejected";
        break;
      case "permission":
        state = "needs-permission";
        break;
      case "rate-limit":
      case "quota":
        state = "limited";
        break;
      default:
        state = "unavailable";
    }
  }

  const copy = PROVIDER_STATUS_COPY[state];
  const failure = input.configured && input.lastCheck?.status === "failure" ? input.lastCheck : null;
  const providerMessage = failure ? safeProviderMessage(failure.error.message) : null;

  return {
    state,
    label: copy.label,
    severity: copy.severity,
    message: providerMessage ? `${copy.message(0)} Provider message: ${providerMessage}` : copy.message(0),
    action: copy.action,
    checkedAt: input.configured && input.lastCheck ? redact(input.lastCheck.checkedAt) : null
  };
}

function safeProviderMessage(message: string): string | null {
  const firstUsefulLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^at\s/.test(line));
  if (!firstUsefulLine) return null;

  const withoutErrorName = firstUsefulLine.replace(/^[A-Za-z]*Error:\s*/, "");
  const safe = redact(withoutErrorName).replace(/[\r\n\t]/g, " ").trim().slice(0, 500);
  return safe && !/^at\s/.test(safe) ? safe : null;
}
