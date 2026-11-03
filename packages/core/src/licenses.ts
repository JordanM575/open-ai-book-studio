import { z } from "zod";

/**
 * The open-source licenses a build ships (D-186).
 *
 * The build writes this report from its own bundle graph: `scripts/licenses.mjs` collects every
 * package whose code ships, with its declared license and its license and notice files. Desktop
 * reads it in the main process and serves it read-only; the browser build fetches it from its own
 * origin. Both validate it with this schema before the view shows it.
 */

const textSchema = z.object({
  file: z.string().min(1).max(200),
  text: z.string().max(2_000_000)
});

const urlSchema = z.string().max(2_000).nullable();

export const licensePackageSchema = z.object({
  name: z.string().min(1).max(214),
  version: z.string().min(1).max(256),
  /** The declared SPDX expression or legacy value; null when the package declares none. */
  license: z.string().max(1_000).nullable(),
  repository: urlSchema,
  homepage: urlSchema,
  author: z.string().max(1_000).nullable(),
  texts: z.array(textSchema).max(50),
  /** Where more credits live, such as Electron's Chromium credits. */
  note: z.string().max(4_000).nullable(),
  /** An exception the license gate allows, with the reason it is recorded under. */
  exception: z.object({ label: z.string().min(1).max(200), reason: z.string().min(1).max(4_000) }).nullable()
});

export const licenseReportSchema = z.object({
  schemaVersion: z.literal(1),
  target: z.enum(["desktop", "web"]),
  project: z.object({
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(256),
    license: z.string().max(1_000).nullable(),
    texts: z.array(textSchema).max(10)
  }),
  packages: z.array(licensePackageSchema).max(10_000)
});

export type LicensePackage = z.infer<typeof licensePackageSchema>;
export type LicenseReport = z.infer<typeof licenseReportSchema>;

/** How a package's license reads: an allowed exception's label, else what the package declares. */
export function licenseLabel(pkg: Pick<LicensePackage, "license" | "exception">): string {
  return pkg.exception?.label ?? pkg.license ?? "No license declared";
}
