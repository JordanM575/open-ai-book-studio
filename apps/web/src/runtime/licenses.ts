import { licenseReportSchema, type LicenseReport } from "@ai-book-studio/core/licenses";

/**
 * The open-source licenses the web build ships (D-186).
 *
 * The build writes `licenses.json` beside `index.html`. It is fetched from the page's own origin,
 * relative to the document so a build served from a subpath still finds it, and validated before
 * the view shows it. A failure says what is wrong in the author's words.
 */
export async function fetchLicenses(base: string = document.baseURI, load: typeof fetch = fetch): Promise<LicenseReport> {
  let response: Response;
  try {
    response = await load(new URL("licenses.json", base));
  } catch {
    throw new Error("The list of open-source licenses could not be loaded. Reload the page and try again.");
  }
  if (!response.ok) {
    throw new Error("This build has no list of open-source licenses. The list is written when the app is built.");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const parsed = licenseReportSchema.safeParse(data);
  if (!parsed.success || parsed.data.target !== "web") {
    throw new Error("This build's list of open-source licenses could not be read.");
  }
  return parsed.data;
}
