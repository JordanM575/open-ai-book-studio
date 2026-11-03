import type { Plugin } from "vite";
import type { LicenseAllowList, LicenseTarget } from "./license-gate.mjs";

export interface LicenseText {
  file: string;
  text: string;
}

export interface LicensePackage {
  name: string;
  version: string;
  /** The declared license, or null when the package declares none. */
  license: string | null;
  repository: string | null;
  homepage: string | null;
  author: string | null;
  texts: LicenseText[];
  note: string | null;
  exception: { label: string; reason: string } | null;
}

export interface LicenseReport {
  schemaVersion: 1;
  target: LicenseTarget;
  project: { name: string; version: string; license: string | null; texts: LicenseText[] };
  packages: LicensePackage[];
}

export interface LicenseCollectorOptions {
  target: LicenseTarget;
  /** Every build that feeds this report; it is written once all of them have written a bundle. */
  builds: string[];
  repoRoot?: string;
  appRoot?: string;
  reportFile?: string;
  noticesFile?: string;
}

export const REPORT_FILES: Record<LicenseTarget, string>;
export const NOTICES_FILE: string;

export function packageRootOf(id: string): string | null;
export function findPackage(from: string, name: string): string | null;
export function declaredLicense(manifest: Record<string, unknown>): string | null;
export function repositoryUrl(repository: unknown): string | null;
export function authorName(author: unknown): string | null;
export function licenseTexts(root: string): LicenseText[];
export function readPackage(root: string): LicensePackage;
export function dependencyClosure(dir: string): { roots: string[]; missing: string[] };
export function stylesheetPackages(file: string, fallbacks?: string[]): string[];
export function readAllowList(repoRoot?: string): LicenseAllowList;
export function createReport(options: {
  target: LicenseTarget;
  roots: string[];
  repoRoot?: string;
  allow?: LicenseAllowList;
}): LicenseReport;
export function licenseLabel(pkg: Pick<LicensePackage, "license" | "exception">): string;
export function noticesTable(report: LicenseReport): string;
export function renderNotices(sections: Partial<Record<LicenseTarget, string>>): string;
export function readNoticeSections(text: string): Partial<Record<LicenseTarget, string>>;
export function updateNotices(file: string, report: LicenseReport): boolean;
export function licenseCollector(options: LicenseCollectorOptions): { plugin(build: string): Plugin };
