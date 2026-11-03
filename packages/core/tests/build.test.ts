import { describe, expect, test } from "bun:test";
import { buildMetadata, capabilitiesFor } from "../src/build";

describe("build metadata", () => {
  test("falls back to development values when no build constants exist", () => {
    const metadata = buildMetadata("desktop");

    expect(metadata.target).toBe("desktop");
    expect(metadata.schemaVersion).toBe(1);
    expect(metadata.version).toBe("0.0.0-dev");
    expect(metadata.commit).toBe("unknown");
  });

  test("every build reports unsigned signing until D-115 is accepted", () => {
    for (const target of ["desktop", "web"] as const) {
      expect(buildMetadata(target).signing).toEqual({ status: "unsigned" });
    }
  });

  test("host identity is injected at the edge and unknown by default", () => {
    expect(buildMetadata("desktop")).toMatchObject({ platform: "unknown", arch: "unknown" });
    const observed = buildMetadata("desktop", { platform: "darwin", arch: "arm64" });
    expect(observed).toMatchObject({ platform: "darwin", arch: "arm64" });
    expect(observed.target).toBe("desktop");
  });

  test("desktop and web capabilities come from one table", () => {
    const desktop = new Map(buildMetadata("desktop").capabilities.map((capability) => [capability.id, capability]));
    const web = new Map(buildMetadata("web").capabilities.map((capability) => [capability.id, capability]));

    expect(desktop.get("storage.folder")?.available).toBe(true);
    expect(web.get("storage.folder")?.available).toBe(true);
    expect(desktop.get("storage.browser")?.available).toBe(false);
    expect(web.get("storage.browser")?.available).toBe(true);
    expect(desktop.get("agent")?.available).toBe(true);
    expect(web.get("agent")?.available).toBe(false);
    expect(web.get("agent")?.reason).toContain("browser");
    expect(desktop.get("archive")?.available).toBe(true);
    expect(web.get("archive")?.available).toBe(true);
  });

  test("every unavailable capability explains itself", () => {
    for (const target of ["desktop", "web"] as const) {
      for (const capability of capabilitiesFor(target)) {
        if (capability.available) {
          expect(capability.reason).toBeUndefined();
        } else {
          expect(capability.reason?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });
});
