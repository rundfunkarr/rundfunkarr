"use client";

import { mediaMetadataComment } from "@/lib/media-metadata";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { Notice } from "@/components/shared/notice";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { Thumbnail } from "@/components/shared/thumbnail";
import { Search, Download, Film } from "lucide-react";
import { formatDuration, formatSize, formatDate } from "@/lib/formatters";

interface SearchResult {
  id: string;
  channel: string;
  topic: string;
  title: string;
  description: string;
  timestamp: number;
  duration: number;
  size: number;
  url_video: string;
  url_video_hd: string;
  url_video_low: string;
  url_website: string;
  url_subtitle?: string;
  audioLanguage?: string;
  url_image?: string;
}

type QualityOption = {
  label: string;
  url: string;
  key: string;
};

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

export default function MoviesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}&limit=50&type=movie`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSearchResults(data.results || []);
      setSearched(true);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
      setError("Die Suche ist fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      setIsSearching(false);
    }
  };

  const getQualityOptions = (result: SearchResult): QualityOption[] => {
    const options: QualityOption[] = [];
    if (result.url_video_hd && result.url_video_hd !== result.url_video) {
      options.push({ label: "HD", url: result.url_video_hd, key: "hd" });
    }
    if (result.url_video) {
      options.push({ label: "SD", url: result.url_video, key: "sd" });
    }
    if (result.url_video_low) {
      options.push({ label: "Low", url: result.url_video_low, key: "low" });
    }
    return options;
  };

  const handleDownload = async (result: SearchResult, url: string, qualityKey: string) => {
    const downloadKey = `${result.id}-${qualityKey}`;
    setDownloadingIds((prev) => new Set(prev).add(downloadKey));
    setError("");
    setMessage("");

    const fileName = `${result.topic} - ${result.title}`.replace(/[<>:"/\\|?*]/g, "_");
    const nzbContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <head>
    <meta type="filename" filename="${fileName}.nzb"/>
  </head>
  <!-- ${url} -->
  <!-- ${mediaMetadataComment(result)} -->
</nzb>`;

    try {
      const res = await fetch("/api/download?mode=addfile&cat=default", {
        method: "POST",
        body: nzbContent,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.status) throw new Error("Download wurde nicht angenommen.");
      setMessage(`„${result.topic}“ wurde zur Warteschlange hinzugefügt.`);
    } catch (err) {
      console.error("Download failed:", err);
      setError("Der Download konnte nicht hinzugefügt werden.");
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(downloadKey);
        return next;
      });
    }
  };

  return (
    <Page>
      <PageHeader
        title="Filme"
        description="Spielfilme und lange Dokumentationen ab 60 Minuten in den Mediatheken finden."
      />

      <Card>
        <CardContent className="p-5">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSearch();
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Filmtitel</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filmtitel eingeben, z. B. Das Boot"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 pl-10 md:text-base"
                required
              />
            </label>
            <Button type="submit" size="lg" className="h-11 sm:px-6" disabled={isSearching}>
              {isSearching ? "Suche läuft…" : "Suchen"}
            </Button>
          </form>
          <p className="mt-2.5 text-xs text-muted-foreground">
            Der deutsche Filmtitel liefert die besten Ergebnisse.
          </p>
        </CardContent>
      </Card>

      {error && <Notice tone="danger">{error}</Notice>}
      {message && (
        <Notice tone="ok">
          {message} <a href="/downloads">Zur Warteschlange</a>
        </Notice>
      )}

      {searchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {searchResults.length} {searchResults.length === 1 ? "Film" : "Filme"} gefunden
            </CardTitle>
            <CardDescription>
              HD lädt die beste verfügbare Direktdatei; SD und Low sind kleinere Fassungen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {searchResults.map((result) => (
              <article key={result.id} className="flex gap-3 rounded-lg border p-4">
                <Thumbnail
                  src={result.url_image}
                  websiteUrl={result.url_website}
                  className="mt-0.5 w-24 sm:w-44"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <ChannelBadge channel={result.channel} />
                      <Badge variant="secondary">{formatDuration(result.duration)}</Badge>
                      {result.title.includes("Gebärdensprache") && (
                        <Flag title="Mit Gebärdensprache">DGS</Flag>
                      )}
                      {(result.title.includes("Audiodeskription") ||
                        result.title.includes("Hörfassung")) && (
                        <Flag title="Mit Audiodeskription">AD</Flag>
                      )}
                      {result.title.includes("Untertitel") && (
                        <Flag title="Mit Untertiteln">UT</Flag>
                      )}
                    </div>
                    <h3 className="mt-1.5 break-words font-medium leading-snug">{result.topic}</h3>
                    {result.title !== result.topic && (
                      <p className="text-sm text-muted-foreground">{result.title}</p>
                    )}
                    {result.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {result.description}
                      </p>
                    )}
                    <p className="tabular mt-2 text-xs text-muted-foreground">
                      {formatDate(result.timestamp)} · {formatSize(result.size)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-row gap-1.5 sm:flex-col">
                    {getQualityOptions(result).map((option) => {
                      const downloadKey = `${result.id}-${option.key}`;
                      return (
                        <Button
                          key={option.key}
                          size="sm"
                          variant={option.key === "hd" ? "default" : "outline"}
                          onClick={() => handleDownload(result, option.url, option.key)}
                          disabled={downloadingIds.has(downloadKey)}
                          className="min-w-20"
                        >
                          <Download />
                          {downloadingIds.has(downloadKey) ? "…" : option.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      )}

      {!isSearching && searched && searchResults.length === 0 && (
        <EmptyState
          icon={Film}
          title={`Keine Filme für „${searchQuery}“ gefunden`}
          description="Anderen Titel oder den deutschen Verleihtitel probieren."
        />
      )}

      {!searched && searchResults.length === 0 && (
        <EmptyState
          icon={Film}
          title="Filmtitel eingeben"
          description="RundfunkArr durchsucht die Mediatheken nach Sendungen ab 60 Minuten."
        />
      )}
    </Page>
  );
}
