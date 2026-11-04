import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#lib/utils";
import { Slot } from "radix-ui";

/*
 * shadcn/ui's Bubble on Liquid Glass (D-185). author and agent use the design kit's bubble tokens;
 * they are the only variants the chat uses, so shadcn's other variants are not carried.
 */
const bubbleVariants = cva(
  "group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end",
  {
    variants: {
      variant: {
        author:
          "*:data-[slot=bubble-content]:bg-[var(--bubble-author-bg)] *:data-[slot=bubble-content]:text-[var(--bubble-author-fg)]",
        agent:
          "*:data-[slot=bubble-content]:bg-[var(--bubble-agent-bg)] *:data-[slot=bubble-content]:text-[var(--bubble-agent-fg)]"
      }
    },
    defaultVariants: {
      variant: "agent"
    }
  }
);

function Bubble({
  variant = "agent",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden rounded-[var(--corner-lg)] border border-transparent px-3 py-2 text-sm leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  );
}

export { Bubble, BubbleContent };
