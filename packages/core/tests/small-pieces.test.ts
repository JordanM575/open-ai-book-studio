import { describe, expect, test } from "bun:test";
import { isProviderErrorCode, normalizeProviderError } from "../src/providers/errors";
import { redact, redactDeep } from "../src/providers/redact";

/**
 * Turning a provider's response into a sentence an author can act on.
 *
 * The distinction that matters is the one between "your key is wrong" and "this account is out of
 * credit": the first sends someone to a settings screen, the second sends them to a billing page,
 * and getting it the wrong way round wastes their afternoon.
 */

describe("provider errors", () => {
  test("a rate limit is named, not guessed from the body", () => {
    expect(normalizeProviderError({ provider: "openrouter", status: 429 }).code).toBe("rate-limit");
  });

  test("a quota is a quota, whatever the status says", () => {
    expect(normalizeProviderError({ provider: "openai", status: 402 }).code).toBe("quota");
    expect(normalizeProviderError({ provider: "openai", status: 400, body: "insufficient credit" }).code).toBe("quota");
  });

  test("a content policy refusal is not reported as a bad key", () => {
    expect(normalizeProviderError({ provider: "meta", status: 400, body: "safety violation" }).code).toBe("refusal");
  });

  test("a rejected key says to reconnect", () => {
    const error = normalizeProviderError({ provider: "anthropic", status: 401 });
    expect(error.code).toBe("auth");
    expect(error.message).toContain("Reconnect");
  });

  test("a request too large for the model says what to do about it", () => {
    const error = normalizeProviderError({ provider: "openai", status: 400, body: "maximum context length exceeded" });
    expect(error.code).toBe("context");
    expect(error.message).toContain("larger model");
  });

  test("a request the provider could not parse is an invalid request", () => {
    expect(normalizeProviderError({ provider: "gemini", status: 422 }).code).toBe("invalid-request");
  });

  test("a server-side problem promises the text is safe", () => {
    const error = normalizeProviderError({ provider: "openai", status: 503 });
    expect(error.code).toBe("unknown");
    expect(error.message).toContain("Your text is safe");
  });

  test("no network is offline, and is not blamed on the provider", () => {
    expect(normalizeProviderError({ provider: "openai", message: "fetch failed" }).code).toBe("offline");
    expect(normalizeProviderError({ provider: "openai", message: "fetch failed", status: 500 }).code).toBe("unknown");
  });

  test("a status nobody planned for keeps the provider's own words", () => {
    const error = normalizeProviderError({ provider: "openai", message: "something new happened" });
    expect(error.code).toBe("unknown");
    expect(error.message).toBe("something new happened");
  });

  test("a response with no message still reads as a sentence", () => {
    expect(normalizeProviderError({ provider: "openai" }).message).toContain("unexpected response");
  });

  test("a retry-after is carried through when the provider sent one", () => {
    const error = normalizeProviderError({ provider: "openai", status: 429, retryAfterSeconds: 30 });
    expect(error.options.retryAfterSeconds).toBe(30);
    expect(error.options.provider).toBe("openai");
    expect(normalizeProviderError({ provider: "openai", status: 429 }).options.retryAfterSeconds).toBeUndefined();
  });

  test("only the codes the interface can explain are codes", () => {
    expect(isProviderErrorCode("auth")).toBe(true);
    expect(isProviderErrorCode("rate-limit")).toBe(true);
    expect(isProviderErrorCode("everything-is-fine")).toBe(false);
  });
});

describe("redaction", () => {
  test("a key is never printed, whatever shape it has", () => {
    const text = redact("authorization: Bearer sk-proj-abcdef123456 and key sk-ant-api03-xyz12345678");
    expect(text).not.toContain("sk-proj-abcdef123456");
    expect(text).not.toContain("sk-ant-api03-xyz12345678");
  });

  test("a sentence with nothing secret in it is left alone", () => {
    expect(redact("The lamp would not turn.")).toBe("The lamp would not turn.");
  });

  test("every provider's key shape is caught, not just the one in the bug report", () => {
    const cases: Array<[string, string]> = [
      ["sk-or-v1-abcdefghijkl", "openrouter"],
      ["sk-proj-abcdefghijklmnop", "openai"],
      ["sk-ant-api03-abcdefgh", "anthropic"],
      ["AIzaSyA1234567890abcdefghijklmnop", "google"],
      ["Basic dXNlcjpwYXNzd29yZA==", "basic"]
    ];
    for (const [value] of cases) {
      expect(redact(`the value was ${value} in the log`)).not.toContain(value);
    }
  });

  test("a key in a query string is redacted but the parameter is still readable", () => {
    const text = redact("https://example.test/v1?api_key=abc123def&other=1");
    expect(text).toContain("api_key=[redacted]");
    expect(text).toContain("other=1");
    expect(text).not.toContain("abc123def");
  });

  test("a key inside JSON is redacted by its name", () => {
    const text = redact('{"apiKey":"secret-value","model":"muse"}');
    expect(text).toContain('"apiKey":"[redacted]"');
    expect(text).toContain('"model":"muse"');
  });

  test("a long hex token is treated as a secret, because that is what it always is", () => {
    const token = "a".repeat(64);
    expect(redact(`hash ${token}`)).toBe("hash [redacted-token]");
  });

  test("deep redaction walks objects and arrays, and blanks a key by its name", () => {
    const request = {
      model: "muse-image",
      apiKey: "sk-proj-abcdefghijklmnop",
      nested: { authorization: "Bearer abcdefghijkl", note: "sk-ant-api03-abcdefgh" },
      list: ["sk-or-v1-abcdefghijkl", 42, true, null]
    };
    const redacted = redactDeep(request);
    expect(redacted.model).toBe("muse-image");
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.nested.authorization).toBe("[redacted]");
    expect(redacted.nested.note).toBe("sk-ant-[redacted]");
    expect(redacted.list[0]).toBe("sk-or-[redacted]");
    expect(redacted.list[1]).toBe(42);
    // The original is not mutated: the request that is sent still has its key.
    expect(request.apiKey).toBe("sk-proj-abcdefghijklmnop");
  });
});
