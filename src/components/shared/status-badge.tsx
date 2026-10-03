import { Badge } from "@/components/ui/badge";

export function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "downloading":
      return <Badge className="bg-blue-500">Lädt</Badge>;
    case "extracting":
      return <Badge className="bg-yellow-500">Konvertiert</Badge>;
    case "paused":
      return <Badge variant="outline">Pausiert</Badge>;
    case "retrying":
      return <Badge className="bg-amber-700">Wiederholung geplant</Badge>;
    case "queued":
      return <Badge variant="secondary">Wartet</Badge>;
    case "completed":
      return <Badge className="bg-green-500">Abgeschlossen</Badge>;
    case "failed":
      return <Badge variant="destructive">Fehlgeschlagen</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
