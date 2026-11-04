import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";
import type { AgentOutcome } from "./agent/runtime";
import { notificationFor, notificationRoute } from "./background-copy";

/**
 * Native notification and dock badge for turns that finish while the author is elsewhere.
 * The shell owns window creation, so a click asks it to show the existing window rather than
 * opening a second one.
 */
export class BackgroundNotifier {
  private current: Notification | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly showWindow: () => void,
    /** Whether this launch's window is never shown (`launchMode`). */
    private readonly headless: boolean
  ) {}

  handle(outcome: AgentOutcome): void {
    const window = this.getWindow();
    const state = {
      visible: window?.isVisible() ?? false,
      focused: window?.isFocused() ?? false
    };
    const route = notificationRoute(outcome, state, this.headless);
    if (!route) return;
    const copy = notificationFor(outcome);
    if (!copy) return;
    if (route === "log") {
      // The title and body only: the words the author would have seen, and nothing else.
      console.log(`[notification] would post ${JSON.stringify({ title: copy.title, body: copy.body })}`);
      return;
    }
    if (!Notification.isSupported()) return;

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
