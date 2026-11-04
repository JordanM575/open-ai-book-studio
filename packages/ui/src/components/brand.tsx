import { BookOpen } from "lucide-react";
import { cn } from "#lib/utils";

export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-[var(--corner-md)] text-white shadow-[var(--elevation-1)]",
        "bg-[linear-gradient(145deg,var(--brand-ribbon-2),var(--brand-ribbon-3)_55%,var(--brand-ribbon-4))]",
        size === "sm" ? "size-7" : "size-9"
      )}
      aria-hidden
    >
      <BookOpen size={size === "sm" ? 14 : 17} strokeWidth={2.2} />
    </div>
  );
}

export function Wordmark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <div className="leading-tight">
        <div className="text-(length:--text-headline-size) font-semibold tracking-[-0.2px]">AI Book Studio</div>
        {subtitle ? <div className="text-(length:--text-caption-size) text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  );
}
