import * as React from "react";

import { cn } from "@/lib/utils";

type NativeProps = Omit<React.ComponentProps<"input">, "type">;

/** Native checkbox tinted with the accent color. */
const Checkbox = React.forwardRef<HTMLInputElement, NativeProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "size-4 shrink-0 cursor-pointer rounded-sm accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";

/** Native checkbox rendered as a switch; keeps form semantics and keyboard behavior. */
const Switch = React.forwardRef<HTMLInputElement, NativeProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    role="switch"
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-muted-foreground/35 transition-colors",
      "before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-white before:shadow-sm before:transition-transform before:content-['']",
      "checked:bg-primary checked:before:translate-x-4",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Switch.displayName = "Switch";

export { Checkbox, Switch };
