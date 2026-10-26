export interface StorageCapabilities {
  secureContext: boolean;
  folderAccess: boolean;
  browserStorage: boolean;
  persistence: boolean;
  locks: boolean;
}

/**
 * Feature detection, never browser-name sniffing.
 *
 * A missing folder picker does not mean the browser cannot store a library; it means the author
 * uses origin storage and the archive as the way out.
 */
export function detectStorageCapabilities(): StorageCapabilities {
  const secureContext = globalThis.isSecureContext === true;
  const picker = typeof window !== "undefined" && "showDirectoryPicker" in window;
  return {
    secureContext,
    folderAccess: secureContext && picker,
    browserStorage: typeof navigator !== "undefined" && Boolean(navigator.storage?.getDirectory),
    persistence: typeof navigator !== "undefined" && Boolean(navigator.storage?.persist),
    locks: typeof navigator !== "undefined" && Boolean(navigator.locks)
  };
}
