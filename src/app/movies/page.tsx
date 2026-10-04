"use client";

import { mediaMetadataComment } from "@/lib/media-metadata";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
}

type QualityOption = {
  label: string;
  url: string;
  key: string;
};

export default function MoviesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}&limit=50&type=movie`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
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
      if (!data.status) {
        console.error("Download failed");
      }
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(downloadKey);
        return next;
      });
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Filme</h1>
        <p className="text-muted-foreground text-sm">
          Suche nach Filmen in den Mediatheken (min. 60 Min.)
        </p>
      </div>

      {/* Search Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="w-5 h-5" />
            Film suchen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filmtitel eingeben..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-10"
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? "Suche..." : "Suchen"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Tipp: Suche nach dem deutschen Filmtitel für beste Ergebnisse
          </p>
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{searchResults.length} Filme gefunden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {searchResults.map((result) => (
              <Card key={result.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {result.channel}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {formatDuration(result.duration)}
                      </Badge>
                      {result.title.includes("Gebärdensprache") && (
                        <Badge className="text-xs bg-purple-600">DGS</Badge>
                      )}
                      {(result.title.includes("Audiodeskription") ||
                        result.title.includes("Hörfassung")) && (
                        <Badge className="text-xs bg-blue-600">AD</Badge>
                      )}
                      {result.title.includes("Untertitel") && (
                        <Badge className="text-xs bg-green-600">UT</Badge>
                      )}
                    </div>
                    <h3 className="font-medium">{result.topic}</h3>
                    {result.title !== result.topic && (
                      <p className="text-sm text-muted-foreground">{result.title}</p>
                    )}
                    {result.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {result.description}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2">
                      {formatDate(result.timestamp)} &bull; {formatSize(result.size)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {getQualityOptions(result).map((option) => {
                      const downloadKey = `${result.id}-${option.key}`;
                      return (
                        <Button
                          key={option.key}
                          size="sm"
                          variant={option.key === "hd" ? "default" : "outline"}
                          onClick={() => handleDownload(result, option.url, option.key)}
                          disabled={downloadingIds.has(downloadKey)}
                          className="min-w-[80px]"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          {downloadingIds.has(downloadKey) ? "..." : option.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isSearching && searchResults.length === 0 && searchQuery && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine Filme gefunden für &quot;{searchQuery}&quot;
          </CardContent>
        </Card>
      )}

      {/* Initial State */}
      {!searchQuery && searchResults.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Film className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              Gib einen Filmtitel ein, um in den Mediatheken zu suchen
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
