import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#lib/utils";
import { Slot } from "radix-ui";

/*
 * shadcn/ui's Badge on Liquid Glass (D-185). muted is the studio's quiet status chip; destructive
 * text uses the token tuned for small type.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--corner-full)] border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        muted: "bg-muted text-muted-foreground"
      }
    },
    defaultVariants: {
      variant: "muted"
    }
  }
);

function Badge({
  className,
  variant = "muted",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
