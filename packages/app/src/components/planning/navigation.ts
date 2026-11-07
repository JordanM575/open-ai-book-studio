import type { DraftSessionState, PlanningView } from "./contracts";
import { viewKey } from "./contracts";

/** Shared by the shell and workspace. Beginning a session blocks navigation before React mounts. */
export class PlanningNavigation {
  private active: { key: string; state: DraftSessionState | null } | null = null;
  private navigating = false;

  begin(view: PlanningView): boolean {
    if (this.active || this.navigating) return false;
    this.active = { key: viewKey(view), state: null };
    return true;
  }
  register(view: PlanningView, state: DraftSessionState): void {
    if (this.active?.key !== viewKey(view)) throw new Error("The planning view is no longer current.");
    this.active.state = state;
  }
  close(view: PlanningView): boolean {
    if (this.active?.key !== viewKey(view)) return false;
    this.active = null;
    return true;
  }
  /** No queued navigation: Keep editing never leaves a latent switch behind. Retry after closing. */
  allow(): boolean {
    if (this.navigating) return false;
    if (!this.active) return true;
    try { this.active.state?.requestClose(); } catch { /* Registration/observer failure stays blocked. */ }
    return false;
  }
  acquire(): (() => void) | null {
    if (!this.allow()) return null;
    this.navigating = true;
    return () => { this.navigating = false; };
  }
}
