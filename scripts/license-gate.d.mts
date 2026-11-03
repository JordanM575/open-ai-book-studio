export type LicenseTarget = "desktop" | "web";

export type LicenseVerdict = "permissive" | "copyleft" | "unknown" | "none" | "unlicensed";

export interface LicenseException {
  name: string;
  license: string;
  builds: LicenseTarget[];
  /** How the notices and the licenses view name the license. */
  label?: string;
  reason: string;
}

export interface LicenseAllowList {
  exceptions: LicenseException[];
}

export interface GatedPackage {
  name: string;
  version: string;
  license: string | null;
}

export interface GatedReport {
  target: LicenseTarget;
  packages: GatedPackage[];
}

export const ALLOW_FILE: string;

export function classifyLicense(declared: string | null | undefined): LicenseVerdict;

export function findException(
  allow: LicenseAllowList,
  target: LicenseTarget,
  pkg: GatedPackage
): LicenseException | undefined;

export function licenseProblems(reports: GatedReport[], allow: LicenseAllowList): string[];
