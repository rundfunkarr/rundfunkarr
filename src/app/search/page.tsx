"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronRight, Download, ExternalLink, Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Thumbnail } from "@/components/shared/thumbnail";
import { cn } from "@/lib/utils";
import { formatDuration, formatSize, formatDate } from "@/lib/formatters";
import type { SearchResult } from "@/app/api/search/route";

type Quality = "low" | "standard" | "high";

/** Accessibility flag in the same ident style as the broadcaster badge. */
function Flag({ children, title }: { children: string; title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex h-5 items-center rounded-sm border border-border px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </span>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}

function SearchView() {
  const params = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const [filters, setFilters] = useState({
    q: initialQuery,
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
  const autoSearched = useRef(false);
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
  // A query handed over from the dashboard runs once on arrival.
  useEffect(() => {
    if (autoSearched.current || initialQuery.trim().length < 2) return;
    autoSearched.current = true;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const qualityField = (
    <Field label="Download-Qualität" className="w-full sm:w-56">
      {(id) => (
        <Select id={id} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
          <option value="high">Hoch / bis 1080p</option>
          <option value="standard">Standard / bis 720p</option>
          <option value="low">Niedrig / bis 480p</option>
        </Select>
      )}
    </Field>
  );
  return (
    <Page>
      <PageHeader
        title="Suche"
        description="Sendungen in den Mediatheken finden und einzeln oder gesammelt herunterladen."
      />
      <Card className="min-w-0">
        <CardContent className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            className="space-y-4"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Suchbegriff</span>
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Titel oder Thema, z. B. Terra X"
                  value={filters.q}
                  onChange={(e) => change("q", e.target.value)}
                  className="h-11 pl-10 md:text-base"
                  minLength={2}
                  maxLength={200}
                  required
                />
              </label>
              <Button type="submit" size="lg" className="h-11 sm:px-6" disabled={busy || adding}>
                {busy ? "Suche läuft…" : "Suchen"}
              </Button>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Sender">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="Alle Sender"
                    value={filters.channel}
                    onChange={(e) => change("channel", e.target.value)}
                    maxLength={100}
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
                    value={filters.minMinutes}
                    onChange={(e) => change("minMinutes", e.target.value)}
                    placeholder="0"
                  />
                )}
              </Field>
              <Field label="Laufzeit bis (Minuten)">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    max={1440}
                    value={filters.maxMinutes}
                    onChange={(e) => change("maxMinutes", e.target.value)}
                    placeholder="Unbegrenzt"
                  />
                )}
              </Field>
              <Field label="Ausgestrahlt ab">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={filters.from}
                    onChange={(e) => change("from", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Ausgestrahlt bis">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={filters.to}
                    onChange={(e) => change("to", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Sortierung">
                {(id) => (
                  <Select
                    id={id}
                    value={filters.sort}
                    onChange={(e) => change("sort", e.target.value)}
                  >
                    <option value="date">Neueste zuerst</option>
                    <option value="title">Titel A–Z</option>
                    <option value="duration">Längste zuerst</option>
                  </Select>
                )}
              </Field>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Laufzeit und Datum filtern die bis zu 1.000 neuesten Treffer der aktivierten Quellen.
              Ein genauer Suchbegriff oder Sender grenzt die Suche bereits an der Quelle ein.
              Datumsgrenzen beziehen sich auf UTC.
            </p>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {qualityField}
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground sm:pb-2">
          Fehlt die gewählte Direktdatei, wird die Standarddatei verwendet. Streams werden auf die
          gewählte Höhe begrenzt.
        </p>
      </div>

      <Card className="min-w-0">
        <CardContent className="p-5">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              Link direkt hinzufügen
            </summary>
            <p className="my-3 text-sm text-muted-foreground">
              MP4-/M3U8-Link oder Sendungsseite von ARD, ZDF, Arte, 3sat, ORF oder SRF. Für
              Sendungsseiten muss HLS aktiviert sein.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void manual();
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <Input
                type="url"
                aria-label="Mediathek-Link"
                placeholder="https://…"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                required
                className="min-w-0 font-mono text-xs md:text-xs"
              />
              <Button disabled={adding || busy} type="submit">
                {adding ? "Wird hinzugefügt…" : "Download hinzufügen"}
              </Button>
            </form>
          </details>
        </CardContent>
      </Card>

      {error && <Notice tone="danger">{error}</Notice>}
      {message && (
        <Notice tone="ok">
          {message} <a href="/downloads">Zur Warteschlange</a>
        </Notice>
      )}

      {searched && (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              {results.length} von {total.toLocaleString("de-DE")} Ergebnissen
            </CardTitle>
            {!!results.length && (
              <CardDescription>
                Bis zu 50 Sendungen lassen sich gemeinsam zur Warteschlange hinzufügen.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {limited && (
              <Notice tone="warn">
                Die Grenze von 1.000 Quelltreffern wurde erreicht. Bitte die Suche eingrenzen, um
                weitere passende Sendungen zu finden.
              </Notice>
            )}
            {!!results.length && (
              <div className="flex flex-wrap items-center gap-2">
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
                  <Download />
                  {selection.size} herunterladen
                </Button>
              </div>
            )}
            {results.map((result) => {
              const isSelected = selection.has(result.id);
              const isAdded = added.has(result.id);
              return (
                <article
                  key={result.id}
                  className={cn(
                    "flex min-w-0 gap-3 rounded-lg border p-4 transition-colors",
                    isSelected && "border-primary/50 bg-primary/5"
                  )}
                >
                  <Checkbox
                    className="mt-1"
                    aria-label={`${result.title} auswählen`}
                    checked={isSelected}
                    disabled={isAdded || adding || (!isSelected && selection.size >= 50)}
                    onChange={(e) =>
                      setSelection((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(result.id);
                        else next.delete(result.id);
                        return next;
                      })
                    }
                  />
                  <Thumbnail
                    src={result.url_image}
                    websiteUrl={result.url_website}
                    className="mt-0.5 w-24 sm:w-40"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <ChannelBadge channel={result.channel} />
                      <span className="break-words text-muted-foreground">{result.topic}</span>
                      {result.category === "movie" && <Badge variant="secondary">Film</Badge>}
                      {result.category === "tv" && <Badge variant="secondary">Serie</Badge>}
                      {result.title.includes("Gebärdensprache") && (
                        <Flag title="Mit Gebärdensprache">DGS</Flag>
                      )}
                      {(result.title.includes("Audiodeskription") ||
                        result.title.includes("Hörfassung")) && (
                        <Flag title="Mit Audiodeskription">AD</Flag>
                      )}
                      {(result.url_subtitle || result.title.includes("Untertitel")) && (
                        <Flag title="Mit Untertiteln">UT</Flag>
                      )}
                    </div>
                    <h2 className="mt-1.5 break-words font-medium leading-snug">{result.title}</h2>
                    {result.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {result.description}
                      </p>
                    )}
                    <p className="tabular mt-2 text-xs text-muted-foreground">
                      {formatDate(result.timestamp)} · {formatDuration(result.duration)} ·{" "}
                      {formatSize(result.size)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "default"}
                        disabled={adding || isAdded || busy}
                        onClick={() => void download([result.id])}
                      >
                        {isAdded ? <Check /> : <Download />}
                        {isAdded ? "Hinzugefügt" : "Herunterladen"}
                      </Button>
                      {/^https?:\/\//i.test(result.url_website) && (
                        <Button asChild variant="ghost" size="sm">
                          <a href={result.url_website} target="_blank" rel="noreferrer">
                            Sendungsseite
                            <ExternalLink />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            {!results.length && (
              <EmptyState
                icon={SearchIcon}
                title="Keine Treffer für diese Filter"
                description="Suchbegriff, Sender oder Zeitraum anpassen."
              />
            )}
            {hasMore && (
              <Button variant="outline" disabled={busy || adding} onClick={() => void search(true)}>
                {busy ? "Wird geladen…" : "Weitere 50 laden"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
