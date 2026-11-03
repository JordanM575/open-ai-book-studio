import { useState } from "react";
import type { SyncSettings } from "@ai-book-studio/core/ipc";
import { Button } from "@ai-book-studio/ui/button";

interface Props {
  deviceName?: string | null | undefined;
  /** Null while loading. */
  settings: SyncSettings | null;
  /** The interval lives in the desktop app; this build only scans and reviews. */
  unsupported: boolean;
  busy: boolean;
  onSaveInterval: (minutes: number) => Promise<void>;
  onCheck: () => Promise<{ dirty: boolean }>;
  onCloseSettings: () => void;
  onNotice: (error: unknown) => void;
}

/** Parse the interval the author typed: empty or out of range never saves. */
function parseInterval(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 1 && value <= 1440 ? value : undefined;
}

function lastScanLine(lastScanAt: string | null): string {
  if (!lastScanAt) return "Never checked.";
  const at = new Date(lastScanAt);
  if (Number.isNaN(at.getTime())) return "Never checked.";
  return `Last checked ${at.toLocaleString()}.`;
}

/**
 * The sync section of Settings. It shows where this library syncs, which device this is and when
 * the drift scan last ran, and offers a scan on demand. The interval editor is hidden where the
 * shell has no interval to configure.
 */
export function SyncSection({
  deviceName,
  settings,
  unsupported,
  busy,
  onSaveInterval,
  onCheck,
  onCloseSettings,
  onNotice
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedNote, setCheckedNote] = useState<string | null>(null);

  const current = settings?.checkIntervalMinutes ?? null;
  const value = draft ?? (current === null ? "" : String(current));
  const parsed = parseInterval(value);
  const unchanged = parsed !== undefined && parsed === current;

  const saveInterval = async (): Promise<void> => {
    if (parsed === undefined || saving) return;
    setSaving(true);
    try {
      await onSaveInterval(parsed);
      setDraft(null);
    } catch (error) {
      onNotice(error);
    } finally {
      setSaving(false);
    }
  };

  const checkNow = async (): Promise<void> => {
    if (checking) return;
    setChecking(true);
    setCheckedNote(null);
    try {
      const { dirty } = await onCheck();
      if (dirty) {
        onCloseSettings();
        return;
      }
      setCheckedNote("Everything matches.");
    } catch (error) {
      onNotice(error);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mt-4">
      <h4 className="text-[var(--text-callout-size)] font-medium">Sync</h4>
      <p className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
        Sync is the folder you chose — iCloud Drive, Google Drive, or a local folder — not a studio
        account. The studio never uploads your books.
      </p>
      {deviceName ? (
        <p className="mt-2 text-[var(--text-subheadline-size)] text-muted-foreground" data-testid="sync-device">
          This device is {deviceName}.
        </p>
      ) : null}
      <p className="mt-1 text-[var(--text-subheadline-size)] text-muted-foreground" data-testid="sync-last-scan">
        {settings ? lastScanLine(settings.lastScanAt) : "Reading…"}
      </p>
      {!unsupported ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <label
              className="block text-[var(--text-caption-size)] text-muted-foreground"
              htmlFor="sync-interval"
            >
              Check for changes every
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="sync-interval"
                type="number"
                min="1"
                max="1440"
                inputMode="numeric"
                placeholder="Minutes, for example 15"
                value={value}
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy || saving || !settings}
                className="w-32 rounded-[var(--corner-md)] border border-border px-3 py-2 text-[var(--text-body-size)]"
                data-testid="sync-interval"
                aria-label="Check for changes every, in minutes"
              />
              <span className="text-[var(--text-subheadline-size)] text-muted-foreground">minutes</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void saveInterval()}
                disabled={busy || saving || parsed === undefined || unchanged}
                data-testid="sync-interval-save"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[var(--text-subheadline-size)] text-muted-foreground">
          The scan interval lives in the desktop app. This build scans when it opens a folder.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void checkNow()}
          disabled={busy || checking}
          data-testid="sync-check"
        >
          Check for changes
        </Button>
        {checkedNote ? (
          <span className="text-[var(--text-subheadline-size)] text-muted-foreground" data-testid="sync-checked-note">
            {checkedNote}
          </span>
        ) : null}
      </div>
    </div>
  );
}
