import { Badge, type BadgeProps } from "@/components/ui/badge";

const states: Record<string, { label: string; variant: BadgeProps["variant"]; dot?: boolean }> = {
  downloading: { label: "Lädt", variant: "info", dot: true },
  extracting: { label: "Konvertiert", variant: "warn", dot: true },
  running: { label: "Skript läuft", variant: "warn", dot: true },
  paused: { label: "Pausiert", variant: "outline" },
  retrying: { label: "Wiederholung geplant", variant: "warn" },
  queued: { label: "Wartet", variant: "muted" },
  completed: { label: "Abgeschlossen", variant: "ok" },
  cancelled: { label: "Abgebrochen", variant: "outline" },
  failed: { label: "Fehlgeschlagen", variant: "danger" },
};

export function getStatusBadge(status: string) {
  const state = states[status.toLowerCase()];
  if (!state) return <Badge variant="outline">{status}</Badge>;
  return (
    <Badge variant={state.variant}>
      {state.dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {state.label}
    </Badge>
  );
}
