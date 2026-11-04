import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "#lib/utils";

/*
 * shadcn/ui's Button (radix-nova) on Liquid Glass (D-185). The studio's variants keep their look;
 * shadcn's names are aliases, so copied components and AI Elements patterns render without edits.
 * Icons keep the size their caller gives them: there is no blanket svg sizing rule here.
 */
const primary = "bg-primary text-primary-foreground shadow-[var(--elevation-1)] hover:brightness-105";
const danger = "bg-destructive text-white hover:brightness-105";
const medium = "h-8 px-3 text-[13px]";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--corner-md)] font-medium transition-[background-color,box-shadow,color,transform] duration-[var(--duration-fast)] disabled:pointer-events-none disabled:opacity-40 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary,
        default: primary,
        secondary: "bg-secondary text-secondary-foreground shadow-[var(--elevation-1)] hover:bg-accent",
        outline: "bg-transparent text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent",
        ghost: "bg-transparent text-foreground hover:bg-accent",
        danger,
        destructive: danger,
        link: "bg-transparent text-primary underline-offset-4 hover:underline"
      },
      size: {
        xs: "h-6 gap-1 px-2 text-[12px]",
        sm: "h-7 px-2.5 text-[13px]",
        md: medium,
        default: medium,
        lg: "h-10 px-4 text-[15px]",
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
        "icon-lg": "size-10 p-0"
      }
    },
    defaultVariants: { variant: "secondary", size: "md" }
  }
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Render the child element with the button's styles, as shadcn/ui's Button does. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "secondary"}
      data-size={size ?? "md"}
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/** The studio's earlier name for the same styles. */
const buttonStyles = buttonVariants;

export { buttonStyles, buttonVariants };
