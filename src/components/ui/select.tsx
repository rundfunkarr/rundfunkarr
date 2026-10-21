import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { controlClassName } from "@/components/ui/input";

/** Native select with the shared control styling; options stay fully accessible. */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => (
    <span className={cn("relative block w-full min-w-0", className)}>
      <select
        ref={ref}
        className={cn(controlClassName, "cursor-pointer appearance-none truncate pr-9")}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
);
Select.displayName = "Select";

export { Select };
