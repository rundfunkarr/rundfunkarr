"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, ScrollText, Stethoscope } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Page, PageHeader } from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { usePolling, type PollRun } from "@/hooks/use-polling";
import type { Diagnostic } from "@/server/diagnostics";
import type { LogEntry } from "@/lib/logger";

const statusLabels = { ok: "In Ordnung", warn: "Prüfen", error: "Fehler", info: "Hinweis" };
const statusVariants: Record<Diagnostic["status"], BadgeProps["variant"]> = {
  ok: "ok",
  warn: "warn",
  error: "danger",
  info: "info",
};
const levelLabels = { info: "Info", warn: "Warnung", error: "Fehler", debug: "Details" };
const levelClasses = {
  error: "text-danger",
  warn: "text-warn",
  info: "text-info",
  debug: "text-muted-foreground",
};

function CheckResult({ check }: { check: Diagnostic }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{check.label}</h3>
        <Badge variant={statusVariants[check.status]}>{statusLabels[check.status]}</Badge>
      </div>
      <p className="mt-1 break-words text-sm text-muted-foreground">{check.message}</p>
    </div>
  );
}

export default function LogsPage() {
  const [adminKey, setAdminKey] = useState("");
  const [input, setInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");
  const lock = useCallback((message = "") => {
    setAdminKey("");
    setInput("");
    setError(message);
  }, []);

  async function unlock() {
    setUnlocking(true);
    setError("");
    try {
      const response = await fetch("/api/logs", {
        headers: { "X-RundfunkArr-Admin-Key": input },
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Freischalten fehlgeschlagen.");
      }
      setAdminKey(input);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Freischalten fehlgeschlagen.");
    } finally {
      setUnlocking(false);
    }
  }

  if (adminKey) return <ProtectedLogs adminKey={adminKey} onLock={lock} />;
  return (
    <Page>
      <PageHeader
        title="Diagnose & Protokoll"
        description="Verbindungen prüfen und Fehler nachvollziehen."
      />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" />
            Admin-Zugriff
          </CardTitle>
          <CardDescription>
            Gib den im Server konfigurierten Admin-Schlüssel ein. Er bleibt nur bis zum Sperren,
            Verlassen oder Neuladen dieser Seite im Speicher.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            className="space-y-4"
          >
            <Field label="Admin-Schlüssel">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  required
                  autoComplete="off"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={unlocking}
                  className="font-mono"
                />
              )}
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" disabled={unlocking}>
              {unlocking ? "Wird geprüft…" : "Freischalten"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Page>
  );
}

function ProtectedLogs({
  adminKey,
  onLock,
}: {
  adminKey: string;
  onLock: (message?: string) => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]),
    [checks, setChecks] = useState<Diagnostic[]>([]),
    [connection, setConnection] = useState<Diagnostic | null>(null);
  const [level, setLevel] = useState("all"),
    [query, setQuery] = useState(""),
    [automatic, setAutomatic] = useState(true),
    [error, setError] = useState("");
  const [testing, setTesting] = useState(false),
    [diagnosing, setDiagnosing] = useState(false),
    [kind, setKind] = useState("sonarr"),
    [url, setUrl] = useState(""),
    [apiKey, setApiKey] = useState("");
  const session = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    return () => controller.abort();
  }, []);
  const lock = useCallback(
    (message?: string) => {
      session.current.abort();
      onLock(message);
    },
    [onLock]
  );
  const adminFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const signal = session.current.signal;
      const headers = new Headers(init?.headers);
      headers.set("X-RundfunkArr-Admin-Key", adminKey);
      const response = await fetch(path, { ...init, headers, signal, cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Die Anfrage ist fehlgeschlagen.";
        if (!signal.aborted && (response.status === 401 || response.status === 503)) lock(message);
        throw new Error(message);
      }
      return response;
    },
    [adminKey, lock]
  );
  const load = useCallback(
    async ({ isCurrent }: PollRun) => {
      const signal = session.current.signal;
      try {
        const response = await adminFetch(`/api/logs?${new URLSearchParams({ level, q: query })}`);
        const data = await response.json();
        if (!signal.aborted && isCurrent()) {
          setEntries(data.entries);
          setError("");
        }
      } catch {
        if (!signal.aborted && isCurrent()) setError("Das Protokoll konnte nicht geladen werden.");
      }
    },
    [level, query, adminFetch]
  );
  const refresh = usePolling(load, automatic ? 5000 : null);
  async function diagnose() {
    const signal = session.current.signal;
    setDiagnosing(true);
    setError("");
    try {
      const response = await adminFetch("/api/diagnostics");
      const data = await response.json();
      if (!signal.aborted) setChecks(data.checks);
    } catch {
      if (!signal.aborted) setError("Die Systemdiagnose ist fehlgeschlagen.");
    } finally {
      if (!signal.aborted) setDiagnosing(false);
    }
  }
  async function testConnection() {
    const signal = session.current.signal;
    setTesting(true);
    setConnection(null);
    try {
      const response = await adminFetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, url, apiKey }),
      });
      const data = await response.json();
      if (signal.aborted) return;
      setConnection(data.check);
      setApiKey("");
    } catch (e) {
      if (signal.aborted) return;
      setConnection({
        id: kind,
        label: kind === "sonarr" ? "Sonarr" : "Radarr",
        status: "error",
        message: e instanceof Error ? e.message : "Verbindungstest fehlgeschlagen.",
      });
    } finally {
      if (!signal.aborted) setTesting(false);
    }
  }
  async function exportLogs() {
    const signal = session.current.signal;
    try {
      const response = await adminFetch(
        `/api/logs?${new URLSearchParams({ level, q: query, format: "text" })}`
      );
      const blob = await response.blob();
      if (signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "rundfunkarr-protokoll.txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      if (!signal.aborted) setError("Das Protokoll konnte nicht exportiert werden.");
    }
  }
  return (
    <Page>
      <PageHeader
        title="Diagnose & Protokoll"
        description="Verbindungen prüfen und Fehler nachvollziehen."
        actions={
          <Button variant="outline" size="sm" onClick={() => lock()}>
            <Lock />
            Zugriff sperren
          </Button>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="size-4 text-muted-foreground" />
              Systemdiagnose
            </CardTitle>
            <CardDescription>
              Prüft Datenbank, lokale Verzeichnisse, FFmpeg, yt-dlp und die MediathekView-Suche.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button disabled={diagnosing} onClick={() => void diagnose()}>
              {diagnosing ? "Prüfung läuft…" : "System prüfen"}
            </Button>
            {checks.length > 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-2">
                {checks.map((check) => (
                  <CheckResult key={check.id} check={check} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Sonarr / Radarr verbinden</CardTitle>
            <CardDescription>
              Testet die Basisadresse und den API-Schlüssel sowie das Vorhandensein aktivierter
              SABnzbd-Clients. Die Angaben werden nicht gespeichert. Der Dateizugriff auf dem
              anderen Host muss dort geprüft werden.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void testConnection();
              }}
              className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <Field label="Anwendung">
                {(id) => (
                  <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="sonarr">Sonarr</option>
                    <option value="radarr">Radarr</option>
                  </Select>
                )}
              </Field>
              <Field label="Basisadresse">
                {(id) => (
                  <Input
                    id={id}
                    type="url"
                    required
                    placeholder="http://sonarr:8989"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="font-mono text-xs md:text-xs"
                  />
                )}
              </Field>
              <Field label="API-Schlüssel">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    required
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono"
                  />
                )}
              </Field>
              <div className="flex items-end">
                <Button disabled={testing} type="submit">
                  {testing ? "Verbindung wird geprüft…" : "Verbindung testen"}
                </Button>
              </div>
            </form>
            {connection && (
              <div role="status">
                <CheckResult check={connection} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-muted-foreground" />
            Aktuelles Protokoll
          </CardTitle>
          <CardDescription>
            Die letzten 500 Einträge dieses Serverprozesses. Nach einem Neustart beginnt die Liste
            neu. Bekannte Zugangsdaten sowie Parameter in Webadressen werden ausgeblendet.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Stufe" className="w-40">
              {(id) => (
                <Select id={id} value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="all">Alle</option>
                  <option value="error">Fehler</option>
                  <option value="warn">Warnungen</option>
                  <option value="info">Informationen</option>
                  <option value="debug">Details</option>
                </Select>
              )}
            </Field>
            <Field label="Im Protokoll suchen" className="min-w-40 flex-1">
              {(id) => (
                <Input
                  id={id}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={200}
                />
              )}
            </Field>
            <Button variant="outline" onClick={() => void refresh()}>
              Aktualisieren
            </Button>
            <Button variant="outline" onClick={() => void exportLogs()}>
              Text exportieren
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} />
              Alle fünf Sekunden aktualisieren
            </label>
            <p className="tabular text-xs text-muted-foreground">
              {entries.length} sichtbare Einträge
            </p>
          </div>
          {entries.length === 0 ? (
            <EmptyState icon={ScrollText} title="Keine Einträge für diese Auswahl" />
          ) : (
            <div className="max-h-[40rem] min-w-0 divide-y overflow-y-auto rounded-lg border bg-background font-mono text-xs">
              {entries.map((entry) => (
                <article
                  key={entry.id}
                  className="grid min-w-0 grid-cols-[auto_4rem_minmax(0,1fr)] gap-x-3 px-3 py-2"
                >
                  <time
                    dateTime={new Date(entry.time).toISOString()}
                    className="tabular whitespace-nowrap text-muted-foreground"
                  >
                    {new Date(entry.time).toLocaleString("de-DE", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </time>
                  <span className={cn("uppercase tracking-wide", levelClasses[entry.level])}>
                    {levelLabels[entry.level]}
                  </span>
                  <pre className="whitespace-pre-wrap break-all font-mono">{entry.message}</pre>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
