import type * as React from "react";
import { cn } from "#lib/utils";
import { Tooltip as TooltipPrimitive } from "radix-ui";

/*
 * shadcn/ui's Tooltip on Liquid Glass (D-185): a tooltip floats, so it is a glass chip with the
 * studio's foreground text rather than shadcn's inverted bubble, and it has no arrow.
 */
function TooltipProvider({ delayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

/** Each tooltip brings its own provider, so no screen has to wrap itself in one. */
function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "glass-strong z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-[var(--corner-sm)] px-2.5 py-1.5 text-xs text-foreground has-data-[slot=kbd]:pr-1.5",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
