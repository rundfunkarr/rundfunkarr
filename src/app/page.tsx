"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bell, CheckCircle2, Download, Radio, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/shared/page";
import { StatTile } from "@/components/shared/stat-tile";
import { EmptyState } from "@/components/shared/empty-state";
import { LiveDot, Progress } from "@/components/shared/progress";
import { getStatusBadge } from "@/components/shared/status-badge";
import { formatSize, formatDateShort } from "@/lib/formatters";

interface QueueSlot {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  mb: string;
  mbleft: string;
  speed: string;
}

interface HistorySlot {
  nzo_id: string;
  name: string;
  status: string;
  completed: number;
  bytes: number;
}

interface Overview {
  // null when the source API could not be read, so a failure never reads as "0".
  completed: number | null;
  failed: number | null;
  subscriptions: number | null;
  paused: number | null;
  newMatches: number | null;
  source: "local" | "building" | "web" | null;
  entries: number;
}

const RUNNING = new Set(["downloading", "extracting", "running"]);

export default function Dashboard() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [history, setHistory] = useState<HistorySlot[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [queuePaused, setQueuePaused] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    try {
      const [queueRes, historyRes, controlRes] = await Promise.all([
        fetch("/api/download?mode=queue"),
        fetch("/api/download?mode=history&limit=6"),
        fetch("/api/download/control"),
      ]);
      const queueData = await queueRes.json();
      const historyData = await historyRes.json();
      setQueue(queueData.queue?.slots || []);
      setHistory((historyData.history?.slots || []).slice(0, 6));
      setHistoryTotal(historyData.history?.noofslots ?? 0);
      if (controlRes.ok) setQueuePaused(!!(await controlRes.json()).paused);
    } catch (error) {
      // eslint-disable-next-line no-console -- client component, logs to the browser console
      console.error("Failed to fetch data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchOverview = useCallback(async () => {
    try {
      // Each source fails on its own, so a network error never leaves stale values behind.
      const load = (path: string) => fetch(path).catch(() => null);
      const [systemRes, subscriptionsRes, filmlisteRes] = await Promise.all([
        load("/api/system"),
        load("/api/subscriptions"),
        load("/api/filmliste"),
      ]);
      const system = systemRes?.ok ? await systemRes.json() : null;
      const subscriptions: { paused: boolean; _count?: { matches: number } }[] | null =
        subscriptionsRes?.ok ? ((await subscriptionsRes.json()).subscriptions ?? []) : null;
      const filmliste = filmlisteRes?.ok ? await filmlisteRes.json() : null;
      setOverview({
        completed: system?.downloads?.completed ?? null,
        failed: system?.downloads?.failed ?? null,
        subscriptions: subscriptions?.length ?? null,
        paused: subscriptions ? subscriptions.filter((item) => item.paused).length : null,
        newMatches: subscriptions
          ? subscriptions.reduce((sum, item) => sum + (item._count?.matches ?? 0), 0)
          : null,
        source: filmliste
          ? filmliste.enabled
            ? filmliste.usable
              ? "local"
              : "building"
            : "web"
          : null,
        entries: filmliste?.entryCount ?? 0,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- client component, logs to the browser console
      console.error("Failed to fetch overview:", error);
    }
  }, []);

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  const running = queue.filter((item) => RUNNING.has(item.status.toLowerCase())).length;

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description="Mediatheken, Warteschlange und Suchabos auf einen Blick."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void fetchActivity();
              void fetchOverview();
            }}
          >
            <RefreshCw />
            Aktualisieren
          </Button>
        }
      />

      <Card>
        <CardContent className="p-5">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              const q = query.trim();
              if (q.length >= 2) router.push(`/search?q=${encodeURIComponent(q)}`);
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Sendung suchen</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Sendung in den Mediatheken suchen, z. B. Terra X"
                className="h-11 pl-10 text-base md:text-base"
                minLength={2}
                maxLength={200}
                required
              />
            </label>
            <Button type="submit" size="lg" className="h-11 sm:px-6">
              Suchen
            </Button>
          </form>
          <p className="mt-2.5 text-xs text-muted-foreground">
            ARD, ZDF, Arte, 3sat, ORF, SRF und weitere Mediatheken. Filter, Mehrfachauswahl und
            Direktlinks gibt es unter{" "}
            <Link href="/search" className="underline underline-offset-4 hover:text-foreground">
              Suche
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <section aria-label="Status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Warteschlange"
          value={queue.length}
          hint={
            queuePaused
              ? "Neue Starts pausiert"
              : running > 0
                ? `${running} ${running === 1 ? "läuft gerade" : "laufen gerade"}`
                : "Nichts in Arbeit"
          }
          icon={Download}
        />
        <StatTile
          label="Abgeschlossen"
          value={overview?.completed != null ? overview.completed.toLocaleString("de-DE") : "–"}
          hint={
            !overview
              ? "Wird geladen…"
              : overview.failed != null
                ? `${overview.failed.toLocaleString("de-DE")} fehlgeschlagen`
                : "Nicht verfügbar"
          }
          icon={CheckCircle2}
        />
        <StatTile
          label="Suchabos"
          value={overview?.subscriptions ?? "–"}
          hint={
            !overview
              ? "Wird geladen…"
              : overview.newMatches === null || overview.paused === null
                ? "Nicht verfügbar"
                : overview.newMatches > 0
                  ? `${overview.newMatches} neue ${overview.newMatches === 1 ? "Meldung" : "Meldungen"}`
                  : overview.paused > 0
                    ? `${overview.paused} pausiert`
                    : "Keine neuen Meldungen"
          }
          icon={Bell}
        />
        <StatTile
          label="Suchquelle"
          value={
            overview?.source === "local"
              ? "Lokal"
              : overview?.source === "building"
                ? "Aufbau"
                : overview?.source === "web"
                  ? "Online"
                  : "–"
          }
          hint={
            overview?.source === "local"
              ? `Filmlisten-Index · ${overview.entries.toLocaleString("de-DE")} Einträge`
              : overview?.source === "building"
                ? "Index wird aufgebaut"
                : overview?.source === "web"
                  ? "MediathekViewWeb"
                  : "Wird geladen…"
          }
          icon={Radio}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2.5">
              {running > 0 && <LiveDot label="Downloads laufen" />}
              Aktive Downloads
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/downloads">
                Warteschlange
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Wird geladen…</p>
            ) : queue.length === 0 ? (
              <EmptyState
                icon={Download}
                title="Keine aktiven Downloads"
                description="Neue Aufträge aus Sonarr, Radarr oder der Suche erscheinen hier."
              />
            ) : (
              <ul className="space-y-2">
                {queue.slice(0, 6).map((item) => {
                  const percent = Number(item.percentage) || 0;
                  return (
                    <li key={item.nzo_id} className="rounded-lg border bg-background/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p
                          className="min-w-0 flex-1 truncate font-mono text-xs"
                          title={item.filename}
                        >
                          {item.filename}
                        </p>
                        <span className="tabular shrink-0 text-sm font-medium">{percent}%</span>
                      </div>
                      <Progress
                        value={percent}
                        label={`Fortschritt: ${item.filename}`}
                        className="mt-2"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {getStatusBadge(item.status)}
                        <span className="tabular">{item.mb} MB</span>
                        {item.speed && <span className="tabular">{item.speed}</span>}
                        {item.timeleft && item.timeleft !== "0:00:00" && (
                          <span className="tabular">{item.timeleft} verbleibend</span>
                        )}
                      </div>
                    </li>
                  );
                })}
                {queue.length > 6 && (
                  <li className="pt-1 text-center text-xs text-muted-foreground">
                    + {queue.length - 6} weitere in der Warteschlange
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Letzte Aktivitäten</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/downloads">
                Alle anzeigen
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Noch keine Downloads"
                description="Abgeschlossene und fehlgeschlagene Aufträge erscheinen hier."
              />
            ) : (
              <ul className="divide-y">
                {history.map((item) => (
                  <li
                    key={item.nzo_id}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    {getStatusBadge(item.status)}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={item.name}>
                      {item.name}
                    </span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {formatDateShort(item.completed)} · {formatSize(item.bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {historyTotal > history.length && (
              <p className="mt-3 text-xs text-muted-foreground">
                {historyTotal.toLocaleString("de-DE")} Einträge in der Historie
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
