"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Diagnostic } from "@/server/diagnostics";
import type { LogEntry } from "@/lib/logger";
const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm min-w-0";
const statusLabels = { ok: "In Ordnung", warn: "Prüfen", error: "Fehler", info: "Hinweis" };
const levelLabels = { info: "Information", warn: "Warnung", error: "Fehler", debug: "Details" };
function CheckResult({ check }: { check: Diagnostic }) {
  return (
    <div className="rounded-md border p-3 min-w-0">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-medium">{check.label}</h3>
        <span
          className={`text-xs ${check.status === "error" ? "text-red-500" : check.status === "warn" ? "text-amber-500" : check.status === "ok" ? "text-green-500" : "text-muted-foreground"}`}
        >
          {statusLabels[check.status]}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mt-1 break-words">{check.message}</p>
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
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 min-w-0">
      <h1 className="text-2xl font-bold">Diagnose & Protokoll</h1>
      <Card>
        <CardHeader>
          <CardTitle>Admin-Zugriff</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            className="space-y-4 max-w-lg"
          >
            <p className="text-sm text-muted-foreground">
              Gib den im Server konfigurierten Admin-Schlüssel ein. Er bleibt nur bis zum Sperren,
              Verlassen oder Neuladen dieser Seite im Speicher.
            </p>
            <label className="text-sm flex flex-col gap-1">
              Admin-Schlüssel
              <Input
                type="password"
                required
                autoComplete="off"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={unlocking}
              />
            </label>
            <Button type="submit" disabled={unlocking}>
              {unlocking ? "Wird geprüft…" : "Freischalten"}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
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
  const sequence = useRef(0);
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
  const load = useCallback(async () => {
    const signal = session.current.signal;
    const id = ++sequence.current;
    try {
      const response = await adminFetch(`/api/logs?${new URLSearchParams({ level, q: query })}`);
      const data = await response.json();
      if (!signal.aborted && id === sequence.current) {
        setEntries(data.entries);
        setError("");
      }
    } catch {
      if (!signal.aborted && id === sequence.current)
        setError("Das Protokoll konnte nicht geladen werden.");
    }
  }, [level, query, adminFetch]);
  useEffect(() => {
    void load();
    const timer = automatic ? setInterval(() => void load(), 5000) : undefined;
    return () => {
      clearInterval(timer);
      sequence.current++;
    };
  }, [load, automatic]);
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
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 min-w-0">
      <div>
        <h1 className="text-2xl font-bold">Diagnose & Protokoll</h1>
        <p className="text-sm text-muted-foreground">
          Verbindungen prüfen und Fehler nachvollziehen
        </p>
        <Button className="mt-3" variant="outline" onClick={() => lock()}>
          Zugriff sperren
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Systemdiagnose</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Prüft Datenbank, lokale Verzeichnisse, FFmpeg, yt-dlp und die MediathekView-Suche.
          </p>
          <Button disabled={diagnosing} onClick={() => void diagnose()}>
            {diagnosing ? "Prüfung läuft…" : "System prüfen"}
          </Button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            {checks.map((check) => (
              <CheckResult key={check.id} check={check} />
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Sonarr / Radarr verbinden</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Testet die Basisadresse und den API-Schlüssel sowie das Vorhandensein aktivierter
            SABnzbd-Clients. Die Angaben werden nicht gespeichert. Der Dateizugriff auf dem anderen
            Host muss dort geprüft werden.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void testConnection();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0"
          >
            <label className="text-sm flex flex-col gap-1">
              Anwendung
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className={selectClass}
              >
                <option value="sonarr">Sonarr</option>
                <option value="radarr">Radarr</option>
              </select>
            </label>
            <label className="text-sm min-w-0">
              Basisadresse
              <Input
                type="url"
                required
                placeholder="http://sonarr:8989"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="text-sm min-w-0">
              API-Schlüssel
              <Input
                type="password"
                required
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            <Button className="self-end" disabled={testing} type="submit">
              {testing ? "Verbindung wird geprüft…" : "Verbindung testen"}
            </Button>
          </form>
          {connection && (
            <div role="status">
              <CheckResult check={connection} />
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Aktuelles Protokoll</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 min-w-0">
          <p className="text-sm text-muted-foreground">
            Die letzten 500 Einträge dieses Serverprozesses. Nach einem Neustart beginnt die Liste
            neu. Bekannte Zugangsdaten sowie Parameter in Webadressen werden ausgeblendet.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-sm flex flex-col gap-1">
              Stufe
              <select
                className={selectClass}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="all">Alle</option>
                <option value="error">Fehler</option>
                <option value="warn">Warnungen</option>
                <option value="info">Informationen</option>
                <option value="debug">Details</option>
              </select>
            </label>
            <label className="text-sm flex-1 min-w-40">
              Im Protokoll suchen
              <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} />
            </label>
            <Button variant="outline" onClick={() => void load()}>
              Aktualisieren
            </Button>
            <Button variant="outline" onClick={() => void exportLogs()}>
              Text exportieren
            </Button>
          </div>
          <label className="flex gap-2 text-sm items-center">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            Alle fünf Sekunden aktualisieren
          </label>
          <p className="text-xs text-muted-foreground">{entries.length} sichtbare Einträge</p>
          <div className="space-y-2 min-w-0 max-h-[40rem] overflow-y-auto">
            {entries.map((entry) => (
              <article key={entry.id} className="rounded-md border p-3 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">
                  {new Date(entry.time).toLocaleString("de-DE")} · {levelLabels[entry.level]}
                </p>
                <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                  {entry.message}
                </pre>
              </article>
            ))}
            {!entries.length && (
              <p className="text-sm text-muted-foreground">Keine Einträge für diese Auswahl.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
