import { existsSync } from "node:fs";
import { join } from "node:path";
import { runLiveChecks, type LiveResult } from "./live-checks";
import type { ProviderService } from "./providers";

/**
 * The live check, run inside the app.
 *
 * The Meta key lives in the operating system's keychain, through the app's own vault, and it is
 * never on the command line where a shell history would keep it. So the check runs here, in the
 * app's own runtime, against the app's own stored connection.
 *
 * The library it writes to is a copy of the committed sample, in a temporary folder, deleted
 * afterwards. The author's own book is never touched.
 */
export async function runLiveCheckInApp(
  providers: ProviderService,
  sampleRoot: string
): Promise<LiveResult[]> {
  const results = await runLiveChecks(providers, { sampleRoot });
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
