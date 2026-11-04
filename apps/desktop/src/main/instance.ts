/**
 * One writer per profile (spec 002 FR-069).
 *
 * Electron keeps the single-instance lock in the userData folder, so the lock belongs to a profile,
 * not to the machine. Every launch the author can see claims it. A hidden test run claims it only
 * when it has a throwaway profile of its own (`STUDIO_TEST=1` with `STUDIO_USER_DATA`, applied
 * before the lock is requested): that lock lives in the throwaway folder, so it can never refuse
 * the author's open studio or be refused by it, while a second copy on the same throwaway profile
 * is refused exactly as a second copy of the real app is. A hidden run on the author's real
 * profile still claims nothing, because it may sit beside the author's own window.
 */
export function claimsSingleInstanceLock(run: {
  headless: boolean;
  isTest: boolean;
  userData: string | undefined;
}): boolean {
  if (!run.headless) return true;
  return run.isTest && Boolean(run.userData);
}

/** The part of a window's web contents that a main-to-renderer signal needs. */
export interface SignalTarget {
  isDestroyed(): boolean;
  isLoading(): boolean;
  once(event: "did-stop-loading", listener: () => void): unknown;
  send(channel: string): void;
}

/**
 * Send a signal the page can hear. A window that was created a moment ago, or is reloading, gets it
 * once loading stops, when the preload is listening; a closed window gets nothing. It waits for
 * `did-stop-loading` rather than `did-finish-load` because `isLoading()` is still true for a moment
 * after `did-finish-load`, and a signal arriving then would wait for a load that has already finished.
 */
export function sendWhenLoaded(contents: SignalTarget, channel: string): void {
  const send = (): void => {
    if (!contents.isDestroyed()) contents.send(channel);
  };
  if (contents.isLoading()) contents.once("did-stop-loading", send);
  else send();
}
