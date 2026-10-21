"use client";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Label + control + hint with consistent spacing. Pass children as a function to
 * receive a generated id for the control, or set `htmlFor` yourself.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
  srOnlyLabel,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
  srOnlyLabel?: boolean;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label
        htmlFor={id}
        className={cn("block text-sm font-medium leading-none", srOnlyLabel && "sr-only")}
      >
        {label}
      </label>
      {typeof children === "function" ? children(id) : children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A labelled toggle row: text on the left, switch or checkbox on the right. */
export function ToggleRow({
  label,
  hint,
  control,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 rounded-md border px-3 py-2.5",
        className
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {control}
    </label>
  );
}
