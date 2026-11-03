import { SCHEMA_VERSION } from "./schema";

export type BuildTarget = "desktop" | "web";

export interface BuildCapability {
  id: string;
  label: string;
  available: boolean;
  /** Present when the capability is unavailable; never a stack trace. */
  reason?: string;
}

/**
 * How the artifact is signed. Every build is unsigned until D-115 is accepted;
 * the wider shape reserves the signed claim (which always names its identity)
 * so About and the release record share one vocabulary.
 */
export interface BuildSigning {
  status: "unsigned" | "signed";
  identity?: string;
}

/**
 * The observed host identity, injected at the platform edge. Desktop reports
 * the OS and CPU it runs on; the browser cannot reliably detect CPU
 * architecture, so web reports "unknown" there per the unknown-label rule.
 */
export interface BuildHost {
  platform: string;
  arch: string;
}

export interface BuildMetadata {
  target: BuildTarget;
  version: string;
  commit: string;
  schemaVersion: number;
  capabilities: BuildCapability[];
  signing: BuildSigning;
  platform: string;
  arch: string;
}

interface CapabilityRow {
  id: string;
  label: string;
  desktop: boolean;
  web: boolean;
  reason?: string;
}

/**
 * One capability table for both builds. A screen asks "is this available here?" instead of
 * scattering `isDesktop` checks, and About can explain every missing feature.
 */
const CAPABILITIES: CapabilityRow[] = [
  { id: "storage.folder", label: "Folder library", desktop: true, web: true },
  {
    id: "storage.browser",
    label: "Browser storage",
    desktop: false,
    web: true,
    reason: "Browser storage belongs to the web build. Use a folder library in the desktop app."
  },
  { id: "archive", label: "Portable archive", desktop: true, web: true },
  {
    id: "export.docx",
    label: "Word export",
    desktop: true,
    web: false,
    reason: "Word export is available in the desktop app. Export an archive in the browser."
  },
  {
    id: "agent",
    label: "Writing agent",
    desktop: true,
    web: false,
    reason: "The browser build does not run the local agent host yet."
  },
  {
    id: "providers.connections",
    label: "Provider connections",
    desktop: true,
    web: false,
    reason: "The browser build has no provider credential vault yet."
  },
  {
    id: "sync.review",
    label: "Sync drift review",
    desktop: false,
    web: false,
    reason: "The drift report interface is not built yet."
  }
];

// Vite replaces these identifiers at build time. `typeof` keeps the same module usable in
// Bun tests, where no build constants exist.
declare const __BUILD_VERSION__: string | undefined;
declare const __BUILD_COMMIT__: string | undefined;

const DEV_VERSION = "0.0.0-dev";
const UNKNOWN_COMMIT = "unknown";

export function capabilitiesFor(target: BuildTarget): BuildCapability[] {
  return CAPABILITIES.map((row) => {
    const available = target === "desktop" ? row.desktop : row.web;
    return {
      id: row.id,
      label: row.label,
      available,
      ...(available ? {} : { reason: row.reason ?? "Not available in this build yet." })
    };
  });
}

export function buildMetadata(target: BuildTarget, host: BuildHost = { platform: "unknown", arch: "unknown" }): BuildMetadata {
  return {
    target,
    version: typeof __BUILD_VERSION__ === "undefined" ? DEV_VERSION : __BUILD_VERSION__,
    commit: typeof __BUILD_COMMIT__ === "undefined" ? UNKNOWN_COMMIT : __BUILD_COMMIT__,
    schemaVersion: SCHEMA_VERSION,
    capabilities: capabilitiesFor(target),
    // Unsigned on every target until D-115 is accepted.
    signing: { status: "unsigned" },
    platform: host.platform,
    arch: host.arch
  };
}
