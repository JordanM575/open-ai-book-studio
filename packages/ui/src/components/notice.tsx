import { useEffect } from "react";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";

export type NoticeSeverity = "info" | "warning" | "danger";

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export interface NoticeProps {
  message: string | null;
  onDismiss: () => void;
  /** Defaults to warning so existing callers keep their transient behavior. */
  severity?: NoticeSeverity;
  /** Keep the safest action first. Only the first two actions are shown. */
  actions?: readonly NoticeAction[];
}

const severityPresentation = {
  info: { Icon: Info, iconLabel: "Information", iconClassName: "text-primary", role: "status" },
  warning: {
    Icon: TriangleAlert,
    iconLabel: "Warning",
    iconClassName: "text-[var(--foreground)]",
    role: "alert"
  },
  danger: {
    Icon: CircleAlert,
    iconLabel: "Danger",
    iconClassName: "text-destructive-text",
    role: "alert"
  }
} as const;

/** A brief notice; danger notices stay visible until the author acknowledges them. */
export function Notice({
  message,
  onDismiss,
  severity = "warning",
  actions = []
}: NoticeProps) {
  useEffect(() => {
    if (!message || severity === "danger") return;
    const timer = setTimeout(onDismiss, 9000);
    return () => clearTimeout(timer);
  }, [message, onDismiss, severity]);

  if (!message) return null;

  const { Icon, iconLabel, iconClassName, role } = severityPresentation[severity];
  const visibleActions = actions.slice(0, 2);

  return (
    <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        role={role}
        aria-live={severity === "info" ? "polite" : "assertive"}
        className="glass-strong flex w-full max-w-[560px] items-start gap-3 rounded-[var(--corner-lg)] py-3 pr-2 pl-4 shadow-[var(--elevation-overlay)]"
      >
        <Icon
          size={18}
          role="img"
          aria-label={iconLabel}
          className={`mt-0.5 shrink-0 ${iconClassName}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-foreground">
            {message}
          </p>
          {visibleActions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleActions.map((action, index) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={
                    index === 0
                      ? "rounded-[var(--corner-md)] bg-primary px-2.5 py-1 text-[13px] font-medium text-primary-foreground shadow-[var(--elevation-1)] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : "rounded-[var(--corner-md)] bg-secondary px-2.5 py-1 text-[13px] font-medium text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
