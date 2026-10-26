import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonStyles = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--corner-md)] font-medium transition-[background-color,box-shadow,color,transform] duration-[var(--duration-fast)] disabled:pointer-events-none disabled:opacity-40 active:translate-y-px",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-[var(--elevation-1)] hover:brightness-105",
        secondary: "bg-secondary text-secondary-foreground shadow-[var(--elevation-1)] hover:bg-accent",
        outline: "bg-transparent text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent",
        ghost: "bg-transparent text-foreground hover:bg-accent",
        danger: "bg-destructive text-white hover:brightness-105"
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-8 px-3 text-[13px]",
        lg: "h-10 px-4 text-[15px]",
        icon: "size-8 p-0",
        "icon-sm": "size-7 p-0"
      }
    },
    defaultVariants: { variant: "secondary", size: "md" }
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref
) {
  return <button ref={ref} type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
});

export { buttonStyles };
