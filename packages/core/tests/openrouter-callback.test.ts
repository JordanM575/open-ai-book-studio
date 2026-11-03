import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  authorizeUrl,
  challengeFor,
  createPkce,
  createState,
  createVerifier,
  OPENROUTER_AUTH_URL,
  PKCE_TIMEOUT_MS,
  readCallback
} from "../src/providers/openrouter";
import { ProviderError } from "../src/providers/types";

/**
 * Sign-in callback properties (spec 012 T011). Every refusal is a typed
 * `ProviderError` that names the remedy and never echoes the code, and the
 * PKCE shape follows RFC 7636, checked against an independent digest.
 */

const STATE = "test-state-000000000000000001";
const CODE = "test-code-000000000000000001";

function callbackUrl(params: Record<string, string>): string {
  const url = new URL("http://127.0.0.1:9/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

describe("openrouter sign-in callback", () => {
  test("a matching state with a code returns the code", () => {
    expect(readCallback(callbackUrl({ state: STATE, code: CODE }), STATE, 1_000, 0)).toEqual({ code: CODE });
  });

  test("a mismatched state is rejected before anything is exchanged", () => {
    const error = readCallbackError(callbackUrl({ state: "someone-elses-state", code: CODE }), STATE, 1_000, 0);
    expect(error.code).toBe("auth");
    expect(error.message).toContain("did not match");
    expect(error.message).not.toContain(CODE);
  });

  test("a missing state is rejected", () => {
    const error = readCallbackError(callbackUrl({ code: CODE }), STATE, 1_000, 0);
    expect(error.code).toBe("auth");
  });

  test("an expired request is rejected even with a matching state", () => {
    const error = readCallbackError(
      callbackUrl({ state: STATE, code: CODE }),
      STATE,
      PKCE_TIMEOUT_MS + 1,
      0
    );
    expect(error.code).toBe("auth");
    expect(error.message).toContain("expired");
    expect(error.message).not.toContain(CODE);
  });

  test("a provider decline is reported with the provider reason", () => {
    const error = readCallbackError(
      callbackUrl({ state: STATE, error: "access_denied" }),
      STATE,
      1_000,
      0
    );
    expect(error.code).toBe("auth");
    expect(error.message).toContain("access_denied");
    expect(error.message).not.toContain(CODE);
  });

  test("a response without a code is rejected", () => {
    const error = readCallbackError(callbackUrl({ state: STATE }), STATE, 1_000, 0);
    expect(error.code).toBe("auth");
    expect(error.message).toContain("did not include a code");
  });

  test("a malformed address is rejected as an invalid request", () => {
    const error = readCallbackError("not a url", STATE, 1_000, 0);
    expect(error.code).toBe("invalid-request");
  });

  test("the PKCE shape follows RFC 7636 and the challenge is the verifier digest", async () => {
    const verifier = createVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(/^[A-Za-z0-9\-_]+$/.test(verifier)).toBe(true);

    const expected = createHash("sha256").update(verifier, "utf8").digest("base64url");
    expect(await challengeFor(verifier)).toBe(expected);

    expect(createState()).not.toBe(createState());
    const pkce = await createPkce(42);
    expect(pkce.createdAt).toBe(42);
    expect(typeof pkce.verifier).toBe("string");
    expect(typeof pkce.state).toBe("string");
  });

  test("the authorize address carries the callback, the method and the state", () => {
    const url = new URL(
      authorizeUrl({ callbackUrl: "http://127.0.0.1:9/callback", challenge: "challenge-1", state: STATE })
    );
    expect(`${url.origin}${url.pathname}`).toBe(OPENROUTER_AUTH_URL);
    expect(url.searchParams.get("callback_url")).toBe("http://127.0.0.1:9/callback");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(STATE);
  });
});

function readCallbackError(rawUrl: string, expectedState: string, now: number, createdAt: number): ProviderError {
  try {
    readCallback(rawUrl, expectedState, now, createdAt);
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error("readCallback should have thrown");
}
