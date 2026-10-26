/**
 * Compatibility re-export. The error type lives with the shared library rules so the desktop
 * adapter, the browser adapters and the IPC layer all branch on the same class and codes.
 */
export { LibraryError, type LibraryErrorCode } from "@ai-book-studio/core/library/errors";
