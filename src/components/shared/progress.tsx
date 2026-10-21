import { cn } from "@/lib/utils";

export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** The one animated element: a signal dot marking live activity. */
export function LiveDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      <span className="absolute inset-0 rounded-full bg-primary motion-safe:animate-signal" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  );
}
