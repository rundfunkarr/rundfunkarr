"use client";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatSize, formatDate } from "@/lib/formatters";
import type { SearchResult } from "@/app/api/search/route";

type Quality = "low" | "standard" | "high";
const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
export default function SearchPage() {
  const [filters, setFilters] = useState({
    q: "",
    channel: "",
    minMinutes: "",
    maxMinutes: "",
    from: "",
    to: "",
    sort: "date",
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [snapshot, setSnapshot] = useState("");
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [limited, setLimited] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState(new Set<string>());
  const [added, setAdded] = useState(new Set<string>());
  const [quality, setQuality] = useState<Quality>("high");
  const [manualUrl, setManualUrl] = useState("");
  const sequence = useRef(0);
  const change = (key: keyof typeof filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  async function search(more = false) {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    setMessage("");
    if (!more) {
      setResults([]);
      setSelection(new Set());
      setAdded(new Set());
      setSnapshot("");
      setHasMore(false);
      setSearched(false);
    }
    try {
      const params = more
        ? new URLSearchParams({ snapshot, offset: String(results.length) })
        : new URLSearchParams(filters);
      const response = await fetch(`/api/search/advanced?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Die Suche ist fehlgeschlagen.");
      if (request !== sequence.current) return;
      setResults((prev) => (more ? [...prev, ...data.results] : data.results));
      setSnapshot(data.snapshot);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setLimited(data.limited);
      setSearched(true);
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : "Die Suche ist fehlgeschlagen.");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function download(ids: string[]) {
    setAdding(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/search/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, ids, quality }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Downloads konnten nicht hinzugefügt werden.");
      const accepted = (data.results as { id: string; downloadId?: string }[])
        .filter((x) => x.downloadId)
        .map((x) => x.id);
      setAdded((prev) => new Set([...prev, ...accepted]));
      setSelection((prev) => new Set([...prev].filter((id) => !accepted.includes(id))));
      setMessage(
        `${accepted.length} Download${accepted.length === 1 ? "" : "s"} zur Warteschlange hinzugefügt.`
      );
      if (accepted.length < ids.length)
        setError(
          "Einige Downloads konnten nicht hinzugefügt werden. Die verbleibende Auswahl kann erneut versucht werden."
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Downloads konnten nicht hinzugefügt werden.");
    } finally {
      setAdding(false);
    }
  }
  async function manual() {
    setAdding(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/search/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: manualUrl, quality }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Der Link konnte nicht hinzugefügt werden.");
      setMessage(`„${data.title}“ wurde zur Warteschlange hinzugefügt.`);
      setManualUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Der Link konnte nicht hinzugefügt werden.");
    } finally {
      setAdding(false);
    }
  }
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 min-w-0">
      <div>
        <h1 className="text-2xl font-bold">Suche</h1>
        <p className="text-muted-foreground text-sm">
          Sendungen finden und gemeinsam herunterladen
        </p>
      </div>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Mediathek durchsuchen</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            className="space-y-4"
          >
            <div className="flex gap-2">
              <label className="flex-1 min-w-0">
                <span className="sr-only">Suchbegriff</span>
                <Input
                  placeholder="Titel oder Thema, z. B. Terra X"
                  value={filters.q}
                  onChange={(e) => change("q", e.target.value)}
                  minLength={2}
                  maxLength={200}
                  required
                />
              </label>
              <Button type="submit" disabled={busy || adding}>
                {busy ? "Suche läuft…" : "Suchen"}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0">
              <label className="text-sm min-w-0">
                Sender
                <Input
                  placeholder="Alle Sender"
                  value={filters.channel}
                  onChange={(e) => change("channel", e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="text-sm min-w-0">
                Laufzeit ab (Minuten)
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={filters.minMinutes}
                  onChange={(e) => change("minMinutes", e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="text-sm min-w-0">
                Laufzeit bis (Minuten)
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={filters.maxMinutes}
                  onChange={(e) => change("maxMinutes", e.target.value)}
                  placeholder="Unbegrenzt"
                />
              </label>
              <label className="text-sm min-w-0">
                Ausgestrahlt ab
                <Input
                  type="date"
                  value={filters.from}
                  onChange={(e) => change("from", e.target.value)}
                />
              </label>
              <label className="text-sm min-w-0">
                Ausgestrahlt bis
                <Input
                  type="date"
                  value={filters.to}
                  onChange={(e) => change("to", e.target.value)}
                />
              </label>
              <label className="text-sm min-w-0">
                Sortierung
                <select
                  className={selectClass}
                  value={filters.sort}
                  onChange={(e) => change("sort", e.target.value)}
                >
                  <option value="date">Neueste zuerst</option>
                  <option value="title">Titel A–Z</option>
                  <option value="duration">Längste zuerst</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Laufzeit und Datum filtern die bis zu 1.000 neuesten Treffer der aktivierten Quellen.
              Ein genauer Suchbegriff oder Sender grenzt die Suche bereits an der Quelle ein.
              Datumsgrenzen beziehen sich auf UTC.
            </p>
          </form>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm min-w-0 w-52">
          Download-Qualität
          <select
            className={selectClass}
            value={quality}
            onChange={(e) => setQuality(e.target.value as Quality)}
          >
            <option value="high">Hoch / bis 1080p</option>
            <option value="standard">Standard / bis 720p</option>
            <option value="low">Niedrig / bis 480p</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground max-w-md">
          Fehlt die gewählte Direktdatei, wird die Standarddatei verwendet. Streams werden auf die
          gewählte Höhe begrenzt.
        </p>
      </div>
      <Card className="min-w-0">
        <CardContent className="pt-5">
          <details>
            <summary className="cursor-pointer font-medium">Link direkt hinzufügen</summary>
            <p className="text-sm text-muted-foreground my-3">
              MP4-/M3U8-Link oder Sendungsseite von ARD, ZDF, Arte, 3sat, ORF oder SRF. Für
              Sendungsseiten muss HLS aktiviert sein.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void manual();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <Input
                type="url"
                aria-label="Mediathek-Link"
                placeholder="https://…"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                required
                className="min-w-0"
              />
              <Button disabled={adding || busy} type="submit">
                {adding ? "Wird hinzugefügt…" : "Download hinzufügen"}
              </Button>
            </form>
          </details>
        </CardContent>
      </Card>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm break-words"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}{" "}
          <a className="underline" href="/downloads">
            Zur Warteschlange
          </a>
        </p>
      )}
      {searched && (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              {results.length} von {total} Ergebnissen
            </CardTitle>
            {limited && (
              <p className="text-sm text-amber-500">
                Die Grenze von 1.000 Quelltreffern wurde erreicht. Bitte die Suche eingrenzen, um
                weitere passende Sendungen zu finden.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!!results.length && (
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={adding}
                  onClick={() =>
                    setSelection(
                      new Set(
                        results
                          .filter((x) => !added.has(x.id))
                          .slice(0, 50)
                          .map((x) => x.id)
                      )
                    )
                  }
                >
                  Bis zu 50 auswählen
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelection(new Set())}
                  disabled={!selection.size || adding}
                >
                  Auswahl aufheben
                </Button>
                <Button
                  size="sm"
                  disabled={!selection.size || adding || busy}
                  onClick={() => void download([...selection])}
                >
                  {selection.size} herunterladen
                </Button>
              </div>
            )}
            {results.map((result) => (
              <article key={result.id} className="rounded-lg border p-4 min-w-0">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    aria-label={`${result.title} auswählen`}
                    checked={selection.has(result.id)}
                    disabled={
                      added.has(result.id) ||
                      adding ||
                      (!selection.has(result.id) && selection.size >= 50)
                    }
                    onChange={(e) =>
                      setSelection((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(result.id);
                        else next.delete(result.id);
                        return next;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2 flex-wrap items-center">
                      <Badge variant="outline">{result.channel}</Badge>
                      <span className="text-sm text-muted-foreground break-words">
                        {result.topic}
                      </span>
                      {result.category === "movie" && (
                        <Badge className="text-xs bg-violet-600">Film</Badge>
                      )}
                      {result.category === "tv" && (
                        <Badge className="text-xs bg-sky-600">Serie</Badge>
                      )}
                      {result.title.includes("Gebärdensprache") && (
                        <Badge className="text-xs bg-purple-600">DGS</Badge>
                      )}
                      {(result.title.includes("Audiodeskription") ||
                        result.title.includes("Hörfassung")) && (
                        <Badge className="text-xs bg-blue-600">AD</Badge>
                      )}
                      {(result.url_subtitle || result.title.includes("Untertitel")) && (
                        <Badge className="text-xs bg-green-600">UT</Badge>
                      )}
                    </div>
                    <h2 className="font-medium mt-1 break-words">{result.title}</h2>
                    {result.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {result.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDate(result.timestamp)} · {formatDuration(result.duration)} ·{" "}
                      {formatSize(result.size)}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-3 items-center">
                      <Button
                        size="sm"
                        disabled={adding || added.has(result.id) || busy}
                        onClick={() => void download([result.id])}
                      >
                        {added.has(result.id) ? "Hinzugefügt" : "Herunterladen"}
                      </Button>
                      {/^https?:\/\//i.test(result.url_website) && (
                        <a
                          href={result.url_website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm underline"
                        >
                          Sendungsseite
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {!results.length && (
              <p className="text-sm text-muted-foreground">
                Keine Treffer für diese Filter. Suchbegriff, Sender oder Zeitraum anpassen.
              </p>
            )}
            {hasMore && (
              <Button variant="outline" disabled={busy || adding} onClick={() => void search(true)}>
                {busy ? "Wird geladen…" : "Weitere 50 laden"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
