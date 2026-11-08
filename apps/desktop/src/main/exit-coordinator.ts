/**
 * Orders a quit so a window can still refuse it.
 *
 * A desktop window can veto its unload from the renderer's `beforeunload` handler — the planning
 * editor does exactly that when it holds unsaved direction. Anything torn down before that veto
 * (the control plane, the agent backend) would leave a studio that stayed open with its services
 * gone, and a latched intent that skips the guard next time. So a granted quit only records intent
 * here; services stop after every window has actually unloaded.
 */
export class ExitCoordinator {
  private granted = false;
  private stopped = false;
  private asking: Promise<void> | null = null;

  /** True once the author's choice allowed quitting and no window has vetoed it since. */
  get quitting(): boolean {
    return this.granted;
  }

  get backendStopped(): boolean {
    return this.stopped;
  }

  /**
   * The `before-quit` step. Returns `true` when this quit may proceed without asking again.
   * The decision runs once; a second quit while it is open waits for the first.
   */
  begin(decide: () => Promise<"stay" | "leave">, quit: () => void): boolean {
    if (this.granted) return true;
    if (this.asking) return false;
    this.asking = decide()
      .then((choice) => {
        if (choice !== "leave") return;
        this.granted = true;
        quit();
      })
      .finally(() => {
        this.asking = null;
      });
    return false;
  }

  /**
   * The `will-quit` step. Returns `true` when quitting may finish. On the first pass it stops the
   * services and calls `quit` again once they are down, so `will-quit` runs a second time cleanly.
   */
  finish(stop: () => Promise<void>, quit: () => void): boolean {
    if (this.stopped) return true;
    this.stopped = true;
    // A stop that fails still lets the quit finish; the caller owns its error log.
    void stop().then(quit, quit);
    return false;
  }

  /**
   * A window refused to unload. No service has been stopped at this point, so only the intent has
   * to be cleared: the next quit asks again instead of bypassing the guard.
   */
  unloadPrevented(): void {
    this.granted = false;
  }
}
