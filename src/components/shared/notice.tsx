import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "ok" | "warn" | "danger";

const styles: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: "border-info/30 bg-info/10 [&>svg]:text-info", icon: Info },
  ok: { box: "border-ok/30 bg-ok/10 [&>svg]:text-ok", icon: CheckCircle2 },
  warn: { box: "border-warn/35 bg-warn/10 [&>svg]:text-warn", icon: AlertTriangle },
  danger: { box: "border-danger/35 bg-danger/10 [&>svg]:text-danger", icon: XCircle },
};

/** Inline message with a reserved status color plus icon, so state never relies on color alone. */
export function Notice({
  tone = "info",
  children,
  className,
  role,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const { box, icon: Icon } = styles[tone];
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        box,
        className
      )}
    >
      <Icon aria-hidden />
      <div className="min-w-0 break-words [&_a]:underline [&_a]:underline-offset-4">{children}</div>
    </div>
  );
}
