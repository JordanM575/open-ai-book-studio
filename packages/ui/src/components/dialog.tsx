import type { ComponentProps, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "#lib/utils";

/*
 * shadcn/ui's Dialog parts on Liquid Glass (D-185). DialogContent keeps the studio's shape: a
 * required title, an optional description and footer, a glass sheet over the scrim, and a close
 * button labelled "Close" that the smoke run and the dialog helpers look for.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn("scrim z-40", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-[var(--text-title-2-size)] leading-[var(--text-title-2-leading)] font-semibold tracking-[-0.2px]",
        className
      )}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("space-y-1.5", className)} {...props} />;
}

export function DialogContent({
  className,
  children,
  title,
  description,
  footer,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: ReactNode; footer?: ReactNode }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "glass-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[512px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--corner-2xl)] p-[var(--space-6)]",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <DialogPrimitive.Close
            className="rounded-full p-1.5 text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="thin-scroll mt-5 min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="mt-4 shrink-0 border-t border-border pt-4">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("mt-6 flex items-center justify-end gap-2", className)} {...props} />;
}
