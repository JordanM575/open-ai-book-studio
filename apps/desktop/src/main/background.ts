import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";
import type { AgentOutcome } from "./agent/runtime";
import { notificationFor, shouldNotify } from "./background-copy";

/**
 * Native notification and dock badge for turns that finish while the author is elsewhere.
 * The shell owns window creation, so a click asks it to show the existing window rather than
 * opening a second one.
 */
export class BackgroundNotifier {
  private current: Notification | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly showWindow: () => void
  ) {}

  handle(outcome: AgentOutcome): void {
    const window = this.getWindow();
    const state = {
      visible: window?.isVisible() ?? false,
      focused: window?.isFocused() ?? false
    };
    if (!shouldNotify(outcome, state)) return;
    const copy = notificationFor(outcome);
    if (!copy || !Notification.isSupported()) return;

    this.current = new Notification({ title: copy.title, body: copy.body });
    this.current.on("click", () => {
      this.showWindow();
      this.clearBadge();
    });
    this.current.show();
    app.dock?.setBadge("•");
  }

  clearBadge(): void {
    app.dock?.setBadge("");
  }
}
