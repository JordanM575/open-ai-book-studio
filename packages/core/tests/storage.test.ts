import { describe, expect, test } from "bun:test";
import { browserStorageWarning, folderPermissionWarning } from "../src/library/storage";

describe("storage disclosure", () => {
  test("browser storage never claims to be a backup", () => {
    for (const persistence of ["granted", "not-granted", "not-supported"] as const) {
      const warning = browserStorageWarning(persistence);
      expect(warning).toContain("browser");
      expect(warning.toLowerCase()).not.toContain("safe");
    }
    expect(browserStorageWarning("granted")).toContain("Clearing site data");
    expect(browserStorageWarning("not-granted")).toContain("may remove it");
    expect(browserStorageWarning("not-granted")).toContain("Export an archive");
    expect(browserStorageWarning("not-supported")).toContain("Export an archive");
  });

  test("folder warnings only appear when permission is incomplete", () => {
    expect(folderPermissionWarning("granted")).toBeNull();
    expect(folderPermissionWarning("read-only")).toContain("read-only");
    expect(folderPermissionWarning("needs-action")).toContain("permission");
    expect(folderPermissionWarning("unavailable")).toContain("unavailable");
  });
});
