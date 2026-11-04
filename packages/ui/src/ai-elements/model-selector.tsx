import type { ComponentProps, ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "#components/dropdown-menu";
import { cn } from "#lib/utils";

/*
 * AI Elements Model Selector (D-185), on shadcn/ui's Dropdown Menu: a short menu of models grouped
 * by connection. The writing agent still chooses models in its own picker dialog; this is the
 * compact form for surfaces that offer a few models in place.
 */
export function ModelSelector(props: ComponentProps<typeof DropdownMenu>) {
  return <DropdownMenu {...props} />;
}

export function ModelSelectorTrigger(props: Omit<ComponentProps<typeof DropdownMenuTrigger>, "asChild">) {
  return <DropdownMenuTrigger asChild {...props} />;
}

export function ModelSelectorContent({ align = "start", ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent align={align} {...props} />;
}

/** The radio group that holds the selected model id. */
export function ModelSelectorList(props: ComponentProps<typeof DropdownMenuRadioGroup>) {
  return <DropdownMenuRadioGroup {...props} />;
}

export function ModelSelectorGroup({
  heading,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuGroup> & { heading?: ReactNode }) {
  return (
    <DropdownMenuGroup {...props}>
      {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
      {children}
    </DropdownMenuGroup>
  );
}

export function ModelSelectorItem(props: ComponentProps<typeof DropdownMenuRadioItem>) {
  return <DropdownMenuRadioItem {...props} />;
}

export function ModelSelectorSeparator(props: ComponentProps<typeof DropdownMenuSeparator>) {
  return <DropdownMenuSeparator {...props} />;
}

export function ModelSelectorName({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="model-selector-name" className={cn("min-w-0 truncate", className)} {...props} />;
}
