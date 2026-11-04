/**
 * Stands in for the manuscript import flow in the browser build (D-188): the core import module
 * and its preview and result dialogs.
 *
 * Staged publication needs the desktop's atomic rename, so the library offers manuscript import on
 * the macOS desktop only (spec 029 T004, T016). The browser build never shows these dialogs or
 * builds an import report. Anything that reaches them gets the browser's own import refusal.
 */
import { MANUSCRIPT_IMPORT_DESKTOP_ONLY } from "../runtime/browser-api";

function refuse(): never {
  throw new Error(MANUSCRIPT_IMPORT_DESKTOP_ONLY);
}

export const buildImportReport = refuse;
export const ImportPreviewDialog = refuse;
export const ImportResultDialog = refuse;
