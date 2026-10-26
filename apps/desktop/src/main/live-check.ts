import { existsSync } from "node:fs";
import { join } from "node:path";
import { runLiveChecks, type LiveResult } from "./live-checks";
import { ProviderError, type ConnectionSummary, type StoredCredential } from "@ai-book-studio/core/providers/types";
import { endpointFor, parseProviderModels } from "@ai-book-studio/core/providers/keys";
import { applyModelPreset } from "@ai-book-studio/core/providers/compatibility";
import type { ProviderService } from "./providers";

/**
 * The live check, run inside the app.
 *
 * The Meta key lives in the operating system's keychain, through the app's own vault, and it is
 * never on the command line where a shell history would keep it. So the check runs here, in the
 * app's own runtime, against the app's own stored connection.
 *
 * There is a second route, for a key that is only in the environment: `META_API_KEY` and
 * `META_BASE_URL` are used when the studio has no stored Meta connection. It is held in memory
 * for the length of the check and written nowhere, but a shell history may keep it, so the
 * stored connection is the better way.
 *
 * The library it writes to is a copy of the committed sample, in a temporary folder, deleted
 * afterwards. The author's own book is never touched.
 */
export async function runLiveCheckInApp(
  providers: ProviderService,
  sampleRoot: string
): Promise<LiveResult[]> {
  const service = (await hasMetaConnection(providers))
    ? providers
    : (fromEnvironment() ?? providers);

  // While the check runs, any request the provider refuses is reported with the status the
  // provider gave and what it said, so a failure names the cause instead of guessing at it.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const response = await originalFetch(input, init);
    if (!response.ok && url.includes("meta")) {
      const body = await response.clone().text().catch(() => "");
      console.error(`[live] refused ${response.status} ${url} — ${body.slice(0, 400).replace(/\s+/g, " ")}`);
    }
    return response;
  }) as typeof fetch;

  const results = await runLiveChecks(service, { sampleRoot }).finally(() => {
    globalThis.fetch = originalFetch;
  });
  for (const result of results) {
    const mark = result.outcome === "ok" ? "ok   " : result.outcome === "blocked" ? "block" : "FAIL ";
    console.log(`[live] ${mark} ${result.name} — ${result.detail}`);
  }
  const failed = results.filter((result) => result.outcome === "failed").length;
  const blocked = results.filter((result) => result.outcome === "blocked").length;
  const ok = results.filter((result) => result.outcome === "ok").length;
  console.log(`[live] ${ok} passed, ${blocked} blocked, ${failed} failed`);
  if (blocked) {
    console.log("[live] A blocked check is an account fact, not a defect: the model or the access is not on this key.");
  }
  return results;
}

async function hasMetaConnection(providers: ProviderService): Promise<boolean> {
  try {
    return (await providers.list()).some((entry) => entry.provider === "meta");
  } catch {
    return false;
  }
}

/** A provider service for a key that is only in the environment. */
function fromEnvironment(): ProviderService | null {
  const secret = process.env.META_API_KEY?.trim();
  // `.env` names it META_API_BASE_URL; the shorter name is accepted too.
  const baseUrl = process.env.META_API_BASE_URL?.trim() ?? process.env.META_BASE_URL?.trim();
  if (!secret || !baseUrl) return null;
  console.log("[live] using the Meta key from the environment, for this run only.");
  const credential: StoredCredential = {
    id: "conn_livecheck01",
    provider: "meta",
    label: "Live check",
    kind: "api-key",
    createdAt: new Date().toISOString(),
    secret,
    metadata: { baseUrl }
  };
  const connection: ConnectionSummary = {
    id: credential.id,
    provider: "meta",
    label: "Live check",
    kind: "api-key",
    createdAt: credential.createdAt
  };
  return {
    list: async () => [connection],
    credential: async (id: string) => {
      if (id !== credential.id) throw new ProviderError("auth", "No such connection.");
      return credential;
    },
    models: async () => {
      const endpoint = endpointFor("meta", secret, baseUrl);
      const response = await fetch(endpoint.url, { headers: endpoint.headers });
      if (!response.ok) {
        throw new ProviderError("auth", `Meta answered ${response.status} for the model list.`);
      }
      const models = parseProviderModels("meta", await response.json()).map((model) =>
        applyModelPreset("meta", model)
      );
      return { models, fetchedAt: new Date().toISOString() };
    }
  } as unknown as ProviderService;
}

/**
 * Where the committed sample library lives.
 *
 * The check copies it into a temporary folder and works there, so the author's own library is
 * never opened. The candidates cover a development run and a run from the repository root.
 */
export function sampleLibraryPath(): string {
  const candidates = [
    join(__dirname, "../../../../samples/the-salt-road"),
    join(process.cwd(), "samples", "the-salt-road"),
    join(__dirname, "../../../../../samples/the-salt-road")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[1]!;
}
