"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SubscriptionInput } from "@/server/subscriptions";
interface Subscription extends SubscriptionInput {
  id: string;
  paused: boolean;
  initialized: boolean;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastError: string | null;
  _count: { matches: number };
}
interface Match {
  id: string;
  title: string;
  topic: string;
  channel: string;
  websiteUrl: string;
  state: string;
  downloadId: string | null;
}
const initial: SubscriptionInput = {
  name: "",
  query: "",
  channel: "",
  minMinutes: 0,
  maxMinutes: 0,
  intervalMinutes: 60,
  quality: "high",
  action: "notify",
  category: "default",
};
const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
export default function SubscriptionsPage() {
  const [items, setItems] = useState<Subscription[]>([]),
    [form, setForm] = useState(initial),
    [editing, setEditing] = useState<string | undefined>(),
    [showForm, setShowForm] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [listError, setListError] = useState(""),
    [matchError, setMatchError] = useState("");
  const visibleError = error || listError || matchError;
  const [selected, setSelected] = useState<string | null>(null),
    [matches, setMatches] = useState<Match[]>([]);
  const [page, setPage] = useState(0);
  const [matchTotal, setMatchTotal] = useState(0);
  const matchRequest = useRef(0);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/subscriptions");
      if (!res.ok) throw new Error();
      setItems((await res.json()).subscriptions);
      setListError("");
    } catch {
      setListError("Suchabos konnten nicht geladen werden.");
    }
  }, []);
  const loadMatches = useCallback(async () => {
    if (!selected) return;
    const request = ++matchRequest.current;
    try {
      const res = await fetch(
        `/api/subscriptions?id=${encodeURIComponent(selected)}&offset=${page * 50}`
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (request !== matchRequest.current) return;
      setMatches(data.matches);
      setMatchError("");
      setMatchTotal(data.total);
      if (page > 0 && page * 50 >= data.total) setPage(Math.max(0, Math.ceil(data.total / 50) - 1));
    } catch {
      if (request === matchRequest.current) setMatchError("Treffer konnten nicht geladen werden.");
    }
  }, [selected, page]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    setMatches([]);
    setMatchError("");
    void loadMatches();
    const timer = setInterval(() => void loadMatches(), 15000);
    return () => {
      clearInterval(timer);
      matchRequest.current++;
    };
  }, [loadMatches]);
  const field = <K extends keyof SubscriptionInput>(key: K, value: SubscriptionInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
      await loadMatches();
      return true;
    } catch (e) {
      setError(
        e instanceof Error && !(e instanceof TypeError)
          ? e.message
          : "Die Aktion konnte nicht abgeschlossen werden."
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (await action({ action: "save", id: editing, input: form })) {
      setShowForm(false);
      setEditing(undefined);
      setForm(initial);
    }
  }
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 min-w-0">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Suchabos</h1>
          <p className="text-sm text-muted-foreground">
            Neue Sendungen zu deinen Themen automatisch finden
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setForm(initial);
            setShowForm(true);
          }}
        >
          Neues Suchabo
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Beim ersten Lauf werden vorhandene Treffer nur vorgemerkt. Erst danach neu entdeckte
        Sendungen erscheinen hier als Meldung oder werden heruntergeladen. Pro Prüfung werden bis zu
        1.000 Quelltreffer berücksichtigt.
      </p>
      {visibleError && (
        <p role="alert" className="text-sm text-red-500">
          {visibleError}
        </p>
      )}
      {showForm && (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{editing ? "Suchabo bearbeiten" : "Suchabo anlegen"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0">
                <label className="text-sm min-w-0">
                  Name
                  <Input
                    value={form.name}
                    onChange={(e) => field("name", e.target.value)}
                    maxLength={100}
                    required
                    placeholder="Dokumentationen am Abend"
                  />
                </label>
                <label className="text-sm min-w-0">
                  Suchbegriff
                  <Input
                    value={form.query}
                    onChange={(e) => field("query", e.target.value)}
                    minLength={2}
                    maxLength={200}
                    required
                    placeholder="Terra X"
                  />
                </label>
                <label className="text-sm min-w-0">
                  Sender
                  <Input
                    value={form.channel}
                    onChange={(e) => field("channel", e.target.value)}
                    maxLength={100}
                    placeholder="Alle Sender"
                  />
                </label>
                <label className="text-sm min-w-0">
                  Laufzeit ab (Minuten)
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    value={form.minMinutes}
                    onChange={(e) => field("minMinutes", Number(e.target.value))}
                  />
                </label>
                <label className="text-sm min-w-0">
                  Laufzeit bis (0 = unbegrenzt)
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    value={form.maxMinutes}
                    onChange={(e) => field("maxMinutes", Number(e.target.value))}
                  />
                </label>
                <label className="text-sm min-w-0">
                  Prüfintervall (Minuten)
                  <Input
                    type="number"
                    min={15}
                    max={10080}
                    value={form.intervalMinutes}
                    onChange={(e) => field("intervalMinutes", Number(e.target.value))}
                    required
                  />
                </label>
                <label className="text-sm min-w-0">
                  Neue Treffer
                  <select
                    className={selectClass}
                    value={form.action}
                    onChange={(e) => field("action", e.target.value as SubscriptionInput["action"])}
                  >
                    <option value="notify">Hier als Meldung anzeigen</option>
                    <option value="download">Automatisch herunterladen</option>
                  </select>
                </label>
                <label className="text-sm min-w-0">
                  Qualität
                  <select
                    className={selectClass}
                    value={form.quality}
                    onChange={(e) =>
                      field("quality", e.target.value as SubscriptionInput["quality"])
                    }
                  >
                    <option value="high">Hoch / bis 1080p</option>
                    <option value="standard">Standard / bis 720p</option>
                    <option value="low">Niedrig / bis 480p</option>
                  </select>
                </label>
                <label className="text-sm min-w-0">
                  Download-Kategorie
                  <select
                    className={selectClass}
                    value={form.category}
                    onChange={(e) =>
                      field("category", e.target.value as SubscriptionInput["category"])
                    }
                  >
                    <option value="default">Standard</option>
                    <option value="tv">Serien (tv)</option>
                    <option value="movie">Filme (movie)</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Ein geänderter Suchbegriff, Sender oder Laufzeitfilter beginnt mit einem neuen
                Vormerklauf. Bereits gestartete Downloads bleiben erhalten. Streams berücksichtigen
                die HLS-Einstellung.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button type="submit" disabled={busy}>
                  {busy ? "Wird gespeichert und geprüft…" : "Speichern und prüfen"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  disabled={busy}
                >
                  Abbrechen
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
        {items.map((item) => (
          <Card key={item.id} className="min-w-0">
            <CardHeader>
              <CardTitle className="break-words">{item.name}</CardTitle>
              <p className="text-sm text-muted-foreground break-words">
                {item.query}
                {item.channel ? ` · ${item.channel}` : ""} ·{" "}
                {item.paused ? "Pausiert" : `Alle ${item.intervalMinutes} Minuten`}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {item.action === "download"
                  ? "Neue Treffer automatisch herunterladen"
                  : "Neue Treffer als Meldung anzeigen"}{" "}
                · {item._count.matches} neue Meldungen
              </p>
              <p className="text-xs text-muted-foreground">
                {item.initialized
                  ? `Zuletzt geprüft: ${item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString("de-DE") : "–"}`
                  : "Erster Vormerklauf steht aus."}
                {!item.paused && (
                  <> · Nächste Prüfung: {new Date(item.nextCheckAt).toLocaleString("de-DE")}</>
                )}
              </p>
              {item.lastError && <p className="text-sm text-amber-500">{item.lastError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setPage(0);
                    setSelected(item.id);
                  }}
                  disabled={busy}
                >
                  Treffer ansehen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action({ action: "pause", id: item.id, paused: !item.paused })
                  }
                >
                  {item.paused ? "Fortsetzen" : "Pausieren"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || item.paused}
                  onClick={() => void action({ action: "check", id: item.id })}
                >
                  Jetzt prüfen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setEditing(item.id);
                    setForm({
                      name: item.name,
                      query: item.query,
                      channel: item.channel,
                      minMinutes: item.minMinutes,
                      maxMinutes: item.maxMinutes,
                      intervalMinutes: item.intervalMinutes,
                      quality: item.quality,
                      action: item.action,
                      category: item.category,
                    });
                    setShowForm(true);
                  }}
                >
                  Bearbeiten
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Suchabo „${item.name}“ und seine Trefferliste löschen? Downloads bleiben erhalten.`
                      )
                    )
                      void action({ action: "delete", id: item.id }).then((ok) => {
                        if (ok && selected === item.id) setSelected(null);
                      });
                  }}
                >
                  Löschen
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!items.length && !showForm && (
        <p className="text-muted-foreground">Noch keine Suchabos angelegt.</p>
      )}
      {selected && (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Neue Treffer: {items.find((x) => x.id === selected)?.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {matchTotal} Treffer · Seite {page + 1} von {Math.max(1, Math.ceil(matchTotal / 50))}.
              Vorgemerkte Altfunde werden ausgeblendet.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Vorherige
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || (page + 1) * 50 >= matchTotal}
                onClick={() => setPage((p) => p + 1)}
              >
                Nächste
              </Button>
            </div>
            {matches.map((match) => (
              <article key={match.id} className="border rounded-md p-3 space-y-2 min-w-0">
                <p className="text-xs text-muted-foreground">
                  {match.channel} · {match.topic}
                </p>
                <h3 className="font-medium break-words">{match.title}</h3>
                <p className="text-xs">
                  {match.state === "queued"
                    ? "Download hinzugefügt"
                    : match.state === "dismissed"
                      ? "Gelesen"
                      : "Neu"}
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  {!match.downloadId && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void action({ action: "download", id: match.id })}
                    >
                      Herunterladen
                    </Button>
                  )}
                  {match.state === "new" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void action({ action: "dismiss", id: match.id })}
                    >
                      Als gelesen markieren
                    </Button>
                  )}
                  {/^https?:\/\//i.test(match.websiteUrl) && (
                    <a
                      className="text-sm underline"
                      href={match.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Sendungsseite
                    </a>
                  )}
                </div>
              </article>
            ))}
            {!matches.length && (
              <p className="text-sm text-muted-foreground">
                Noch keine neuen Sendungen seit dem ersten Vormerklauf gefunden.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
