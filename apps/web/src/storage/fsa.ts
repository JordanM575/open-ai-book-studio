import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import {
  folderPermissionWarning,
  type StoragePermission,
  type StorageSummary
} from "@ai-book-studio/core/library/storage";
import { DirectoryHandleLibraryPort, webLock } from "./directory-port";

type PermissionState = "granted" | "denied" | "prompt";

interface PermissionHandle {
  queryPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
}

interface PickerWindow {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}

/** The author must initiate this call from a click; browsers reject it otherwise. */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = typeof window === "undefined" ? undefined : (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new LibraryPortError(
      "unsupported",
      "This browser cannot open a folder. Use browser storage, or export an archive to move the library."
    );
  }
  try {
    return await picker.call(window, { id: "ai-book-studio", mode: "readwrite" });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return null;
    throw error;
  }
}

export async function folderPermission(handle: FileSystemDirectoryHandle): Promise<StoragePermission> {
  const permission = handle as unknown as PermissionHandle;
  if (!permission.queryPermission) return "granted";
  const state = await permission.queryPermission({ mode: "readwrite" });
  return state === "granted" ? "granted" : state === "denied" ? "unavailable" : "needs-action";
}

/** Must be called from a user gesture when the browser reports `prompt`. */
export async function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<StoragePermission> {
  const permission = handle as unknown as PermissionHandle;
  if (!permission.requestPermission) return "granted";
  const state = await permission.requestPermission({ mode: "readwrite" });
  return state === "granted" ? "granted" : state === "denied" ? "unavailable" : "needs-action";
}

export function folderPort(handle: FileSystemDirectoryHandle): DirectoryHandleLibraryPort {
  return new DirectoryHandleLibraryPort(handle, { lock: webLock });
}

export function folderSummary(
  handle: FileSystemDirectoryHandle,
  permission: StoragePermission,
  lastCommittedAt: string | null = null
): StorageSummary {
  return {
    tier: "folder",
    label: handle.name || "Chosen folder",
    permission,
    persistence: "not-supported",
    lastCommittedAt,
    warning: folderPermissionWarning(permission)
  };
}
