export const HEALTH_SEVERITIES = ["info", "warning", "danger"] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

export interface HealthActionCopy {
  id: string;
  label: string;
  /** Health copy may offer only actions that are safe to take in the described state. */
  safe: true;
}

export interface HealthStateCopy {
  label: string;
  severity: HealthSeverity;
  message: (count: number) => string;
  action: HealthActionCopy;
}

/** Shared, UI-neutral descriptions of what each notice severity means. */
export const HEALTH_SEVERITY_COPY: Record<
  HealthSeverity,
  { label: string; icon: "info" | "warning" | "alert"; message: string }
> = {
  info: {
    label: "Information",
    icon: "info",
    message: "No immediate problem needs attention."
  },
  warning: {
    label: "Warning",
    icon: "warning",
    message: "Something needs your attention before you continue."
  },
  danger: {
    label: "Action required",
    icon: "alert",
    message: "Continuing could overwrite or lose data. Resolve this before saving."
  }
};

export const LOCATION_HEALTH_STATES = [
  "ready",
  "not-downloaded",
  "offline",
  "permission-needed",
  "conflicts",
  "checking"
] as const;
export type LocationHealthState = (typeof LOCATION_HEALTH_STATES)[number];

export const LOCATION_HEALTH_COPY: Record<LocationHealthState, HealthStateCopy> = {
  ready: {
    label: "Ready",
    severity: "info",
    message: () => "This location is ready. The studio will use it when you work with this library.",
    action: { id: "continue", label: "Continue working", safe: true }
  },
  "not-downloaded": {
    label: "Not downloaded",
    severity: "danger",
    message: (count) => {
      const files = count === 1 ? "1 file is" : `${count} files are`;
      return `${files} still online-only. The studio cannot read them; open them to download before editing.`;
    },
    action: { id: "download-files", label: "Open files to download", safe: true }
  },
  offline: {
    label: "Offline",
    severity: "warning",
    message: () => "This location is offline. The studio will not read or change files there; reconnect it or choose another folder.",
    action: { id: "reconnect-location", label: "Reconnect location", safe: true }
  },
  "permission-needed": {
    label: "Permission needed",
    severity: "warning",
    message: () => "The studio cannot read this location. It will not change files there; restore folder access to continue.",
    action: { id: "restore-access", label: "Restore folder access", safe: true }
  },
  conflicts: {
    label: "Conflicts",
    severity: "warning",
    message: (count) => {
      const copies = count === 1 ? "1 conflict copy needs" : `${count} conflict copies need`;
      return `${copies} review. The studio will keep both versions; review the copies before editing.`;
    },
    action: { id: "review-conflicts", label: "Review conflicts", safe: true }
  },
  checking: {
    label: "Checking",
    severity: "info",
    message: () => "The studio is checking this location. The check will not change your files; wait for it to finish.",
    action: { id: "wait-for-check", label: "Wait for the check", safe: true }
  }
};

export const PROVIDER_STATUS_STATES = [
  "connected",
  "not-set-up",
  "key-rejected",
  "needs-permission",
  "limited",
  "unavailable"
] as const;
export type ProviderStatusState = (typeof PROVIDER_STATUS_STATES)[number];

export const PROVIDER_STATUS_COPY: Record<ProviderStatusState, HealthStateCopy> = {
  connected: {
    label: "Connected",
    severity: "info",
    message: () => "This provider is connected. The studio will use it when you choose it.",
    action: { id: "continue", label: "Continue", safe: true }
  },
  "not-set-up": {
    label: "Not set up",
    severity: "info",
    message: () => "No connection is set up. The studio will not send requests to this provider; add a connection to use it.",
    action: { id: "add-connection", label: "Add a connection", safe: true }
  },
  "key-rejected": {
    label: "Key rejected",
    severity: "warning",
    message: () => "The provider rejected this connection. The studio will not use it until you replace the key.",
    action: { id: "replace-key", label: "Replace key", safe: true }
  },
  "needs-permission": {
    label: "Needs permission",
    severity: "warning",
    message: () =>
      "The key was accepted but lacks permission for that request. Check the key's scopes or plan before trying again.",
    action: { id: "check-key-permissions", label: "Check key permissions", safe: true }
  },
  limited: {
    label: "Limited",
    severity: "warning",
    message: () => "The provider is rate limiting requests or has reached its quota. Wait, or check your provider's limits before trying again.",
    action: { id: "check-limits", label: "Check provider limits", safe: true }
  },
  unavailable: {
    label: "Unavailable",
    severity: "warning",
    message: () => "A usable connection is not available. The studio will not use this provider until a check succeeds; check the connection or try again.",
    action: { id: "check-connection", label: "Check connection", safe: true }
  }
};
