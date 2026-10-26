import type { ComponentProps, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  footer,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: ReactNode; footer?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="scrim z-40" />
      <DialogPrimitive.Content
        className={cn(
          "glass-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[512px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--corner-2xl)] p-[var(--space-6)]",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <DialogPrimitive.Title className="text-[var(--text-title-2-size)] leading-[var(--text-title-2-leading)] font-semibold tracking-[-0.2px]">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="rounded-full p-1.5 text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-accent hover:text-foreground" aria-label="Close">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="thin-scroll mt-5 min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="mt-4 shrink-0 border-t border-border pt-4">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-6 flex items-center justify-end gap-2", className)} {...props} />;
}
