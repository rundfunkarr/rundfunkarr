import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Headline number. Values wear text tokens; an icon or dot may carry state. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 rounded-xl border bg-card p-4 shadow-xs dark:shadow-none", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow truncate">{label}</span>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      <div className="tabular mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
