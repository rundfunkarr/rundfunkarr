"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, ExternalLink, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { EmptyState } from "@/components/shared/empty-state";
import { ChannelBadge } from "@/components/shared/channel-badge";
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
const formatTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–";
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
  const openNew = () => {
    setEditing(undefined);
    setForm(initial);
    setShowForm(true);
  };
  const selectedItem = items.find((x) => x.id === selected);
  return (
    <Page>
      <PageHeader
        title="Suchabos"
        description="Neue Sendungen zu deinen Themen automatisch finden und auf Wunsch sofort laden."
        actions={
          <Button onClick={openNew}>
            <Plus />
            Neues Suchabo
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        Beim ersten Lauf werden vorhandene Treffer nur vorgemerkt. Erst danach neu entdeckte
        Sendungen erscheinen hier als Meldung oder werden heruntergeladen. Pro Prüfung werden bis zu
        1.000 Quelltreffer berücksichtigt.
      </p>
      {visibleError && <Notice tone="danger">{visibleError}</Notice>}
      {showForm && (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{editing ? "Suchabo bearbeiten" : "Suchabo anlegen"}</CardTitle>
            <CardDescription>
              Ein geänderter Suchbegriff, Sender oder Laufzeitfilter beginnt mit einem neuen
              Vormerklauf. Bereits gestartete Downloads bleiben erhalten. Streams berücksichtigen
              die HLS-Einstellung.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              className="space-y-4"
            >
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Name">
                  {(id) => (
                    <Input
                      id={id}
                      value={form.name}
                      onChange={(e) => field("name", e.target.value)}
                      maxLength={100}
                      required
                      placeholder="Dokumentationen am Abend"
                    />
                  )}
                </Field>
                <Field label="Suchbegriff">
                  {(id) => (
                    <Input
                      id={id}
                      value={form.query}
                      onChange={(e) => field("query", e.target.value)}
                      minLength={2}
                      maxLength={200}
                      required
                      placeholder="Terra X"
                    />
                  )}
                </Field>
                <Field label="Sender">
                  {(id) => (
                    <Input
                      id={id}
                      value={form.channel}
                      onChange={(e) => field("channel", e.target.value)}
                      maxLength={100}
                      placeholder="Alle Sender"
                    />
                  )}
                </Field>
                <Field label="Laufzeit ab (Minuten)">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      max={1440}
                      value={form.minMinutes}
                      onChange={(e) => field("minMinutes", Number(e.target.value))}
                    />
                  )}
                </Field>
                <Field label="Laufzeit bis (0 = unbegrenzt)">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      max={1440}
                      value={form.maxMinutes}
                      onChange={(e) => field("maxMinutes", Number(e.target.value))}
                    />
                  )}
                </Field>
                <Field label="Prüfintervall (Minuten)">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={15}
                      max={10080}
                      value={form.intervalMinutes}
                      onChange={(e) => field("intervalMinutes", Number(e.target.value))}
                      required
                    />
                  )}
                </Field>
                <Field label="Neue Treffer">
                  {(id) => (
                    <Select
                      id={id}
                      value={form.action}
                      onChange={(e) =>
                        field("action", e.target.value as SubscriptionInput["action"])
                      }
                    >
                      <option value="notify">Hier als Meldung anzeigen</option>
                      <option value="download">Automatisch herunterladen</option>
                    </Select>
                  )}
                </Field>
                <Field label="Qualität">
                  {(id) => (
                    <Select
                      id={id}
                      value={form.quality}
                      onChange={(e) =>
                        field("quality", e.target.value as SubscriptionInput["quality"])
                      }
                    >
                      <option value="high">Hoch / bis 1080p</option>
                      <option value="standard">Standard / bis 720p</option>
                      <option value="low">Niedrig / bis 480p</option>
                    </Select>
                  )}
                </Field>
                <Field label="Download-Kategorie">
                  {(id) => (
                    <Select
                      id={id}
                      value={form.category}
                      onChange={(e) =>
                        field("category", e.target.value as SubscriptionInput["category"])
                      }
                    >
                      <option value="default">Standard</option>
                      <option value="tv">Serien (tv)</option>
                      <option value="movie">Filme (movie)</option>
                    </Select>
                  )}
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
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
      {items.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="flex min-w-0 flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="break-words">{item.name}</CardTitle>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className="break-words">„{item.query}“</span>
                      {item.channel && <ChannelBadge channel={item.channel} />}
                    </p>
                  </div>
                  {item.paused ? (
                    <Badge variant="outline">Pausiert</Badge>
                  ) : item._count.matches > 0 ? (
                    <Badge variant="info">
                      {item._count.matches} {item._count.matches === 1 ? "neue" : "neue"}
                    </Badge>
                  ) : (
                    <Badge variant="ok">Aktiv</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Prüfung</dt>
                  <dd className="tabular">
                    {item.paused ? "Pausiert" : `Alle ${item.intervalMinutes} Minuten`}
                  </dd>
                  <dt className="text-muted-foreground">Neue Treffer</dt>
                  <dd>
                    {item.action === "download"
                      ? "Automatisch herunterladen"
                      : "Als Meldung anzeigen"}
                  </dd>
                  <dt className="text-muted-foreground">Zuletzt</dt>
                  <dd className="tabular">
                    {item.initialized
                      ? formatTime(item.lastCheckedAt)
                      : "Erster Vormerklauf steht aus"}
                  </dd>
                  {!item.paused && (
                    <>
                      <dt className="text-muted-foreground">Nächste</dt>
                      <dd className="tabular">{formatTime(item.nextCheckAt)}</dd>
                    </>
                  )}
                </dl>
                {item.lastError && <Notice tone="warn">{item.lastError}</Notice>}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant={selected === item.id ? "secondary" : "default"}
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
                    variant="ghost"
                    className="text-danger hover:text-danger"
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
      )}
      {!items.length && !showForm && (
        <EmptyState
          icon={Bell}
          title="Noch keine Suchabos angelegt"
          description="Ein Suchabo prüft die Mediatheken regelmäßig nach einem Suchbegriff und meldet oder lädt neue Sendungen."
          action={
            <Button onClick={openNew}>
              <Plus />
              Neues Suchabo
            </Button>
          }
        />
      )}
      {selected && (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Neue Treffer: {selectedItem?.name}</CardTitle>
            <CardDescription>
              {matchTotal} Treffer · Seite {page + 1} von {Math.max(1, Math.ceil(matchTotal / 50))}.
              Vorgemerkte Altfunde werden ausgeblendet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {matchTotal > 50 && (
              <div className="flex flex-wrap gap-2">
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
            )}
            {matches.map((match) => (
              <article key={match.id} className="min-w-0 space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <ChannelBadge channel={match.channel} />
                  <span className="text-muted-foreground">{match.topic}</span>
                  {match.state === "queued" ? (
                    <Badge variant="ok">Download hinzugefügt</Badge>
                  ) : match.state === "dismissed" ? (
                    <Badge variant="muted">Gelesen</Badge>
                  ) : (
                    <Badge variant="info">Neu</Badge>
                  )}
                </div>
                <h3 className="break-words font-medium leading-snug">{match.title}</h3>
                <div className="flex flex-wrap items-center gap-2 pt-1">
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
                    <Button asChild variant="ghost" size="sm">
                      <a href={match.websiteUrl} target="_blank" rel="noreferrer">
                        Sendungsseite
                        <ExternalLink />
                      </a>
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {!matches.length && (
              <EmptyState
                icon={Bell}
                title="Noch keine neuen Sendungen"
                description="Seit dem ersten Vormerklauf wurde nichts Neues gefunden."
              />
            )}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
