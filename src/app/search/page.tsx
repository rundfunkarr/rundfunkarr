"use client";

import { mediaMetadataComment } from "@/lib/media-metadata";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Download } from "lucide-react";
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
  url_website: string;
  url_subtitle?: string;
  audioLanguage?: string;
  category?: "movie" | "tv" | "unknown";
}

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=50`);
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

  const handleDownload = async (result: SearchResult) => {
    setDownloadingIds((prev) => new Set(prev).add(result.id));

    const fileName = `${result.topic} - ${result.title}`.replace(/[<>:"/\\|?*]/g, "_");
    const nzbContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <head>
    <meta type="filename" filename="${fileName}.nzb"/>
  </head>
  <!-- ${result.url_video_hd || result.url_video} -->
  <!-- ${mediaMetadataComment(result)} -->
</nzb>`;

    // Use category for download folder: movie -> /movie, tv -> /tv
    const cat = result.category === "movie" ? "movie" : result.category === "tv" ? "tv" : "default";

    try {
      const res = await fetch(`/api/download?mode=addfile&cat=${cat}`, {
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
        next.delete(result.id);
        return next;
      });
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Suche</h1>
        <p className="text-muted-foreground text-sm">Durchsuche die Mediatheken</p>
      </div>

      {/* Search Input */}
      <Card>
        <CardHeader>
          <CardTitle>Mediathek durchsuchen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Suchbegriff eingeben..."
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
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{searchResults.length} Ergebnisse</CardTitle>
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
                      <span className="text-sm text-muted-foreground">{result.topic}</span>
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
                    <h3 className="font-medium">{result.title}</h3>
                    {result.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {result.description}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2">
                      {formatDate(result.timestamp)} &bull; {formatDuration(result.duration)} &bull;{" "}
                      {formatSize(result.size)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleDownload(result)}
                    disabled={downloadingIds.has(result.id)}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    {downloadingIds.has(result.id) ? "..." : "Download"}
                  </Button>
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
            Keine Ergebnisse gefunden für &quot;{searchQuery}&quot;
          </CardContent>
        </Card>
      )}
    </div>
  );
}
