import { BrowserWindow, session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { LibraryError } from "./library/errors";

/*
 * The manuscript's HTML becomes a PDF in Chromium's own print path, so the desktop needs no
 * external binary (D-108).
 *
 * The page is served from memory by an in-memory session that answers every http and https
 * request itself: the page at its one-time address, and "not found" for anything else. So nothing
 * the page asks for can reach the network, nothing is written to disk, the illustrations inlined
 * in the HTML exist only for the length of the render, and a long illustrated book is not cut off
 * by Chromium's limit on data URLs. The page runs no JavaScript, and the window is destroyed
 * afterwards whether the render worked or not.
 */

/** No `persist:` prefix: the session lives in memory and keeps nothing between launches. */
const PARTITION = "studio-pdf-export";
/** A reserved name that never resolves. The session answers for it, so no lookup is made. */
const PAGE_ORIGIN = "http://manuscript.invalid";
const RENDER_TIMEOUT_MS = 120_000;

/** The pages being rendered, by one-time token. Each entry is removed when its render ends. */
const pages = new Map<string, string>();
let prepared: Session | null = null;

function exportSession(): Session {
  if (prepared) return prepared;
  const pdfSession = session.fromPartition(PARTITION, { cache: false });
  // The page has no remote references and a CSP that forbids them; this is the second lock.
  const answer = (request: Request): Response => {
    const token = request.url.startsWith(`${PAGE_ORIGIN}/`) ? request.url.slice(PAGE_ORIGIN.length + 1) : "";
    const html = pages.get(token);
    if (html === undefined) return new Response("Not found", { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  pdfSession.protocol.handle("http", answer);
  pdfSession.protocol.handle("https", answer);
  pdfSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pdfSession.setPermissionCheckHandler(() => false);
  prepared = pdfSession;
  return pdfSession;
}

/**
 * Renders one HTML document to PDF bytes in a hidden window.
 *
 * Page size and margins are also set in the page's own CSS (`@page`), and both say A4 with
 * one-inch margins, the same geometry the Word export inherits from its library.
 */
export async function renderPdfInHiddenWindow(html: string): Promise<Uint8Array> {
  const pdfSession = exportSession();
  const token = randomUUID();
  pages.set(token, html);
  const window = new BrowserWindow({
    show: false,
    focusable: false,
    skipTaskbar: true,
    width: 794,
    height: 1123,
    webPreferences: {
      session: pdfSession,
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      webgl: false,
      navigateOnDragDrop: false,
      backgroundThrottling: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const rendered = (async () => {
      await window.loadURL(`${PAGE_ORIGIN}/${token}`);
      return window.webContents.printToPDF({
        pageSize: "A4",
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
        preferCSSPageSize: true,
        printBackground: false
      });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new LibraryError("io", "The PDF took too long to make. Nothing was written. Try the export again.")),
        RENDER_TIMEOUT_MS
      );
    });
    return new Uint8Array(await Promise.race([rendered, timeout]));
  } finally {
    if (timer) clearTimeout(timer);
    pages.delete(token);
    if (!window.isDestroyed()) window.destroy();
  }
}
