import type * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "#lib/utils";

/*
 * shadcn/ui's Native Select on Liquid Glass (D-185). It stays a real <select>, so the platform's own
 * picker, keyboard behaviour and form semantics come for free; the field wears the studio's input
 * style. className sizes the wrapper; the select fills it.
 */
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

function NativeSelect({ className, size = "default", ...props }: NativeSelectProps) {
  return (
    <div
      className={cn("group/native-select relative w-fit has-[select:disabled]:opacity-40", className)}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-9 w-full min-w-0 appearance-none rounded-[var(--corner-md)] bg-card py-1 pr-8 pl-3 text-[var(--text-body-size)] text-foreground shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none transition-shadow duration-[var(--duration-fast)] focus-visible:shadow-[inset_0_0_0_2px_var(--input-focus)] disabled:pointer-events-none data-[size=sm]:h-8 data-[size=sm]:pr-7 data-[size=sm]:pl-2 data-[size=sm]:text-[var(--text-caption-size)]"
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground group-data-[size=sm]/native-select:right-2"
      />
    </div>
  );
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return (
    <option data-slot="native-select-option" className={cn("bg-[Canvas] text-[CanvasText]", className)} {...props} />
  );
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
