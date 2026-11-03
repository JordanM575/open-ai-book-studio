import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { licenseReportSchema, type LicenseReport } from "@ai-book-studio/core/licenses";

/**
 * The open-source licenses this build ships (D-186).
 *
 * The build writes `licenses.json` beside the main bundle, and the packaged app carries it there,
 * inside the archive. It is read once, validated and kept; nothing writes it at run time. A failure
 * says what is wrong in the author's words and never names a path.
 */
export function createLicenseReader(file: string = join(__dirname, "licenses.json")): () => Promise<LicenseReport> {
  let report: Promise<LicenseReport> | null = null;
  return () => {
    report ??= load(file).catch((error: unknown) => {
      report = null;
      throw error;
    });
    return report;
  };
}

async function load(file: string): Promise<LicenseReport> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error("This build has no list of open-source licenses. The list is written when the app is built.");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const parsed = licenseReportSchema.safeParse(data);
  if (!parsed.success || parsed.data.target !== "desktop") {
    throw new Error("This build's list of open-source licenses could not be read.");
  }
  return parsed.data;
}
