import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { redact } from "@ai-book-studio/core/providers/redact";
import { capturePage, redactLine } from "../../../scripts/failure-artifacts.mjs";

// Every secret below is assembled at runtime so this file never contains a key-shaped
// string that the repository secret scan would flag.
function joinParts(...parts: string[]): string {
  return parts.join("");
}
const BODY = joinParts("Q7mZ2vN8pR4sT6xY9aB3cD5eF", "7gH1jK2");
const SECRETS = [
  `token ${joinParts("sk", "-", "or-v1")}-${BODY} end`,
  `token ${joinParts("sk", "-", "ant")}-${joinParts("AbCdEfGhIjKlMnOpQrStUvWx", "Yz12")} end`,
  `token ${joinParts("sk", "-", "proj")}-${joinParts("1234567890abcdef1234567890")} end`,
  `token ${joinParts("AI", "za", "SyD1234567890abcdefghij")} end`,
  `header ${joinParts("Bea", "rer")} ${joinParts("abcdefgh12345678")} end`,
  `header ${joinParts("Ba", "sic")} ${joinParts("dXNlcjpw", "YXNz")} end`,
  `url https://host/path?${joinParts("api", "_key")}=${joinParts("super", "secret")}&x=1 end`,
  `body {${joinParts('"api', 'Key"')} : ${joinParts('"super', 'secret"')}} end`,
  `hex ${joinParts("0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdef")} end`,
  "The keeper lit the lamp and the stairs went quiet."
];

describe("failure artifacts", () => {
  test("redaction matches the core helper on every secret shape", () => {
    for (const line of SECRETS) {
      expect(redactLine(line)).toBe(redact(line));
    }
  });

  test("redaction keeps ordinary prose and never throws", () => {
    expect(redactLine("The keeper counted the gulls.")).toBe("The keeper counted the gulls.");
    expect(redactLine(undefined)).toBe("");
  });

  test("desktop smoke redaction mirrors the shared helper", async () => {
    // apps/desktop/src/main/smoke.ts keeps its own copy because the smoke bundle cannot
    // import the script helper. This test fails if either list of patterns drifts.
    const root = join(import.meta.dir, "..", "..", "..");
    const [helper, smoke] = await Promise.all([
      readFile(join(root, "scripts", "failure-artifacts.mjs"), "utf8"),
      readFile(join(root, "apps", "desktop", "src", "main", "smoke.ts"), "utf8")
    ]);
    const regexSources = (text: string, marker: string): string[] => {
      const block = text.slice(text.indexOf(marker), text.indexOf("];", text.indexOf(marker)));
      return [...block.matchAll(/\/((?:\\.|[^/])+)\/([gimsuy]*)/g)].map((m) => `${m[1] ?? ""}/${m[2] ?? ""}`);
    };
    const stringLiterals = (text: string, marker: string): string[] => {
      const block = text.slice(text.indexOf(marker), text.indexOf("];", text.indexOf(marker)));
      return [...block.matchAll(/"((?:\\.|[^"])*)"/g)].map((m) => m[1] ?? "");
    };
    expect(regexSources(smoke, "const REDACT_PATTERNS")).toEqual(regexSources(helper, "const PATTERNS"));
    expect(stringLiterals(smoke, "const REDACT_REPLACEMENTS")).toEqual(
      stringLiterals(helper, "const REPLACEMENTS")
    );
  });

  test("page capture collects redacted errors and discards cleanly", async () => {
    interface FakeConsoleMessage {
      type: () => string;
      text: () => string;
    }
    const listeners = new Map<string, (message: FakeConsoleMessage | Error) => void>();
    const calls: Array<[string, string | undefined]> = [];
    const page = {
      on: (event: string, listener: (message: FakeConsoleMessage | Error) => void): void => {
        listeners.set(event, listener);
      },
      off: (event: string): void => {
        listeners.delete(event);
      },
      screenshot: (options: { path: string }): Promise<void> => {
        calls.push(["screenshot", options.path]);
        return Promise.resolve();
      },
      context: () => ({
        tracing: {
          start: (): Promise<void> => {
            calls.push(["trace-start", undefined]);
            return Promise.resolve();
          },
          stop: (options?: { path?: string }): Promise<void> => {
            calls.push(["trace-stop", options?.path]);
            return Promise.resolve();
          }
        }
      })
    };
    const capture = await capturePage(page);
    listeners.get("console")?.({
      type: () => "error",
      text: () => `boom ${joinParts("sk", "-", "or-v1")}-${BODY}`
    });
    listeners.get("console")?.({ type: () => "log", text: () => "quiet" });
    listeners.get("pageerror")?.(new Error("page broke"));
    expect(capture.errors).toEqual([`boom ${joinParts("sk", "-or-", "[redacted]")}`, "page broke"]);
    const saved = await capture.save("/tmp", "some view@1024");
    expect(saved.screenshot).toBe("/tmp/some-view-1024.png");
    expect(saved.trace).toBe("/tmp/some-view-1024.trace.zip");
    expect(saved.consoleLog).toBe("/tmp/some-view-1024.console.log");
    await capture.discard();
    expect(calls).toContainEqual(["trace-start", undefined]);
    expect(calls).toContainEqual(["trace-stop", undefined]);
  });
});
