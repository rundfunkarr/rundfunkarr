"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { Thumbnail } from "@/components/shared/thumbnail";
import { RefreshCw, Search, Tv, ExternalLink } from "lucide-react";

interface Show {
  id: number;
  name: string;
  germanName: string | null;
  slug: string | null;
  overview: string | null;
  firstAired: string | null;
  image: string | null;
  cachedAt: string;
  expiresAt: string;
  _count: {
    episodes: number;
  };
}

export default function ShowsPage() {
  const [shows, setShows] = useState<Show[]>([]);
  const [filteredShows, setFilteredShows] = useState<Show[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchShows = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/shows");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setShows(Array.isArray(data) ? data : []);
      setFilteredShows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch shows:", error);
      setShows([]);
      setFilteredShows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShows();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredShows(shows);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredShows(
        shows.filter(
          (show) =>
            show.name.toLowerCase().includes(query) ||
            (show.germanName && show.germanName.toLowerCase().includes(query))
        )
      );
    }
  }, [searchQuery, shows]);

  return (
    <Page>
      <PageHeader
        title="Serien"
        description="Serien, die Sonarr angefragt hat, mit ihren Metadaten aus TVDB."
        actions={
          <Button variant="outline" size="sm" onClick={fetchShows}>
            <RefreshCw />
            Aktualisieren
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Tv className="size-4 text-muted-foreground" />
            {filteredShows.length} {filteredShows.length === 1 ? "Serie" : "Serien"}
          </CardTitle>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Serien durchsuchen</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Serien durchsuchen…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </label>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Wird geladen…</p>
          ) : filteredShows.length === 0 ? (
            <EmptyState
              icon={Tv}
              title={shows.length === 0 ? "Noch keine Serien im Cache" : "Keine Serien gefunden"}
              description={
                shows.length === 0
                  ? "Serien werden automatisch zwischengespeichert, sobald Sonarr nach ihnen sucht."
                  : "Für diese Suche gibt es keine passende Serie."
              }
            />
          ) : (
            <Table scrollLabel="Serien" className="min-w-[48rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>TVDB-ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Deutscher Name</TableHead>
                  <TableHead className="text-right">Episoden</TableHead>
                  <TableHead>Erstausstrahlung</TableHead>
                  <TableHead className="w-20">Links</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredShows.map((show) => (
                  <TableRow key={show.id}>
                    <TableCell className="tabular font-mono text-xs text-muted-foreground">
                      {show.id}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <Thumbnail
                          src={show.image}
                          ratio="poster"
                          setting="posters"
                          className="w-8"
                          always
                          fallback={<Tv className="size-3.5" aria-hidden />}
                        />
                        <span>{show.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {show.germanName || "–"}
                    </TableCell>
                    <TableCell className="tabular text-right">{show._count.episodes}</TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {show.firstAired
                        ? new Date(show.firstAired).toLocaleDateString("de-DE")
                        : "–"}
                    </TableCell>
                    <TableCell>
                      {show.slug ? (
                        <a
                          href={`https://thetvdb.com/series/${show.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        >
                          TVDB <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
