import { cn } from "@/lib/utils";

/** Broadcaster shown as a compact station ident: monospace, uppercase, boxed. */
export function ChannelBadge({ channel, className }: { channel: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm border border-border bg-muted/60 px-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-foreground/90",
        className
      )}
    >
      {channel}
    </span>
  );
}
