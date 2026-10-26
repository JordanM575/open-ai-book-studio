import { useEffect } from "react";
import { X } from "lucide-react";

/** A single transient message. Errors are the only thing that uses it: they should be rare. */
export function Notice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 9000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div className="glass-strong flex max-w-[560px] items-start gap-3 rounded-[var(--corner-lg)] py-3 pr-2 pl-4 shadow-[var(--elevation-overlay)]">
        <span className="mt-[7px] size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
        <p className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-foreground">
          {message}
        </p>
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
