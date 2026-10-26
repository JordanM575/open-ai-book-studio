import { useState } from "react";
import { FolderOpen, HardDrive } from "lucide-react";
import { Wordmark } from "@ai-book-studio/ui/brand";
import { Button } from "@ai-book-studio/ui/button";
import { detectStorageCapabilities } from "./storage/capabilities";
import type { BrowserLibraries } from "./runtime/browser-libraries";

interface Props {
  libraries: BrowserLibraries;
  onOpened: () => void;
}

export function WebWelcome({ libraries, onOpened }: Props) {
  const capabilities = detectStorageCapabilities();
  const [busy, setBusy] = useState<"browser" | "folder" | "reconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "browser" | "folder" | "reconnect", work: () => Promise<unknown>): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await work();
      onOpened();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="window-wash flex min-h-full items-center justify-center px-4 py-10" data-testid="web-welcome">
      <div className="glass w-full max-w-[520px] rounded-[var(--corner-2xl)] p-6 min-[700px]:p-8">
        <Wordmark subtitle="Library" />
        <h1 className="mt-6 text-[26px] leading-[32px] font-semibold tracking-[-0.3px]">Where should your library live?</h1>
        <p className="mt-2 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
          This is the same library the desktop app reads: one folder per book, one Markdown file per chapter. A folder is a real folder on this device. “This browser” keeps it in this browser profile, where you can export an archive to move it.
        </p>

        {libraries.pendingFolder ? (
          <div className="mt-5 rounded-[var(--corner-lg)] border border-border p-3">
            <p className="text-[var(--text-subheadline-size)] font-medium">Reconnect {libraries.pendingFolder.name}</p>
            <p className="mt-1 text-[var(--text-caption-size)] text-muted-foreground">
              The browser needs permission again before it can open this folder.
            </p>
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={busy !== null}
              onClick={() => void run("reconnect", () => libraries.reconnectFolder())}
            >
              <FolderOpen size={15} />
              {busy === "reconnect" ? "Reconnecting…" : "Reconnect folder"}
            </Button>
          </div>
        ) : null}

        <div className="mt-5 grid gap-2">
          <Button
            variant={libraries.pendingFolder ? "secondary" : "primary"}
            className="h-11 justify-start"
            disabled={busy !== null}
            onClick={() => void run("browser", () => libraries.useBrowserStorage())}
            data-testid="use-browser-storage"
          >
            <HardDrive size={16} />
            {busy === "browser" ? "Opening…" : "Use this browser"}
          </Button>
          {capabilities.folderAccess ? (
            <Button
              variant="secondary"
              className="h-11 justify-start"
              disabled={busy !== null}
              onClick={() => void run("folder", () => libraries.chooseFolder())}
              data-testid="choose-web-folder"
            >
              <FolderOpen size={16} />
              {busy === "folder" ? "Opening…" : "Choose a folder…"}
            </Button>
          ) : null}
        </div>

        <p className="mt-4 text-[var(--text-caption-size)] leading-[var(--text-caption-leading)] text-muted-foreground">
          {capabilities.folderAccess
            ? "A folder can be opened by the desktop app and other editors. Browser storage cannot: export an archive to move it."
            : "This browser cannot open a folder. The library stays in this browser profile; export an archive to move it."}
        </p>
        {!capabilities.secureContext ? (
          <p className="mt-2 text-[var(--text-caption-size)] text-[var(--destructive-text)]">
            Open the studio over HTTPS or localhost. Local storage is unavailable on this origin.
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 text-[var(--text-caption-size)] text-[var(--destructive-text)]" role="alert">
            {error}
          </p>
        ) : null}
        {libraries.restoreError ? (
          <p className="mt-3 text-[var(--text-caption-size)] text-[var(--destructive-text)]">{libraries.restoreError}</p>
        ) : null}
      </div>
    </div>
  );
}
