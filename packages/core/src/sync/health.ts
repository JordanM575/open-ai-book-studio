import { LOCATION_HEALTH_COPY, type HealthActionCopy, type HealthSeverity, type LocationHealthState } from "../health/copy";
import { SYNC_SCHEMA_VERSION, type SyncFile, type SyncJournal } from "./types";

/** A host adapter supplies these observations; this module never probes or reads a location. */
export type LocationProbeState = "available" | "checking" | "offline" | "permission-needed";

export interface LocationHealth {
  state: LocationHealthState;
  label: string;
  count: number;
  severity: HealthSeverity;
  message: string;
  action: HealthActionCopy;
}

/**
 * Derive one location status from scan observations and the local sync journal.
 * Conflict copies already represented in a current journal have been reviewed on this device, as
 * in detectDrift(). The optional probe state describes failures a file list cannot express.
 */
export function locationHealth(
  files: readonly SyncFile[],
  journal: SyncJournal | null,
  probeState: LocationProbeState = "available"
): LocationHealth {
  let state: LocationHealthState;
  let count = 0;

  if (probeState !== "available") {
    state = probeState;
  } else {
    const permissionIssue = files.some((file) =>
      /permission|access denied|operation not permitted/i.test(file.unreadable ?? "")
    );
    const placeholderCount = files.filter((file) => file.placeholder === true).length;
    const currentJournal = journal?.schemaVersion === SYNC_SCHEMA_VERSION ? journal : null;
    const conflictCount = files.filter((file) => {
      const isConflict = file.conflict === true || /(^|\/)conflicts\//.test(file.path);
      return isConflict && !currentJournal?.files[file.path];
    }).length;

    if (permissionIssue) {
      state = "permission-needed";
    } else if (placeholderCount > 0) {
      state = "not-downloaded";
      count = placeholderCount;
    } else if (conflictCount > 0) {
      state = "conflicts";
      count = conflictCount;
    } else {
      state = "ready";
    }
  }

  const copy = LOCATION_HEALTH_COPY[state];
  return {
    state,
    label: copy.label,
    count,
    severity: copy.severity,
    message: copy.message(count),
    action: copy.action
  };
}
