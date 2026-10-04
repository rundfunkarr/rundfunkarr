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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RulesetEditor } from "@/components/rulesets/ruleset-editor";
import type { RulesetInput } from "@/lib/ruleset-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Search, Settings2, Trash2, ExternalLink } from "lucide-react";

interface Ruleset {
  id: string;
  topic: string;
  tvdbId: number;
  showName: string;
  germanName: string | null;
  matchingStrategy: RulesetInput["matchingStrategy"];
  filters: string;
  episodeRegex: string;
  seasonRegex: string;
  titleRegexRules: string;
  createdAt: string;
  updatedAt: string | null;
  source: "local" | "community";
}

export default function RulesetsPage() {
  const [editing, setEditing] = useState<Ruleset | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [filteredRulesets, setFilteredRulesets] = useState<Ruleset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; ruleset: Ruleset | null }>({
    show: false,
    ruleset: null,
  });

  const fetchRulesets = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/rulesets");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setError(null);
      setRulesets(Array.isArray(data) ? data : []);
      setFilteredRulesets(Array.isArray(data) ? data : []);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Regeln konnten nicht geladen werden.");
      setRulesets([]);
      setFilteredRulesets([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRulesets();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredRulesets(rulesets);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredRulesets(
        rulesets.filter(
          (rs) =>
            rs.topic.toLowerCase().includes(query) ||
            rs.showName.toLowerCase().includes(query) ||
            (rs.germanName && rs.germanName.toLowerCase().includes(query))
        )
      );
    }
  }, [searchQuery, rulesets]);

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.ruleset) return;

    try {
      const res = await fetch(`/api/rulesets?id=${deleteConfirm.ruleset.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Löschen fehlgeschlagen.");
      setMessage("Lokale Regel gelöscht. Die Community-Regeln gelten wieder.");
      fetchRulesets();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteConfirm({ show: false, ruleset: null });
    }
  };

  const getStrategyBadge = (strategy: string) => {
    switch (strategy) {
      case "SeasonAndEpisodeNumber":
        return <Badge variant="outline">S+E Nummer</Badge>;
      case "ItemTitleExact":
      case "ItemTitleIncludes":
        return <Badge variant="secondary">Titel Match</Badge>;
      case "ItemTitleEqualsAirdate":
        return <Badge>Datum</Badge>;
      default:
        return <Badge variant="outline">{strategy}</Badge>;
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rulesets</h1>
          <p className="text-muted-foreground text-sm">Matching-Regeln für Shows</p>
        </div>
        <Button variant="outline" onClick={fetchRulesets}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Aktualisieren
        </Button>
      </div>

      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        onClick={() => {
          setEditing(null);
          setMessage(null);
        }}
      >
        Eigene Regel anlegen
      </Button>
      {editing !== undefined && (
        <RulesetEditor
          key={editing?.id || "new"}
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setMessage("Lokale Regel gespeichert. Sie gilt ab der nächsten Suche.");
            void fetchRulesets();
          }}
        />
      )}

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rulesets durchsuchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Rulesets Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            {filteredRulesets.length} Rulesets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-center py-8">Laden...</p>
          ) : filteredRulesets.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {rulesets.length === 0
                ? "Keine Rulesets vorhanden. Rulesets werden automatisch generiert wenn Sonarr nach Shows sucht."
                : "Keine Rulesets gefunden für diese Suche."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead>Show</TableHead>
                    <TableHead>TVDB ID</TableHead>
                    <TableHead>Strategie</TableHead>
                    <TableHead>Quelle</TableHead>
                    <TableHead className="w-24">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRulesets.map((rs) => (
                    <TableRow key={rs.id}>
                      <TableCell className="font-medium">{rs.topic}</TableCell>
                      <TableCell>
                        <div>
                          <span>{rs.showName}</span>
                          {rs.germanName && (
                            <span className="text-muted-foreground text-sm block">
                              {rs.germanName}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <a
                          href={`https://thetvdb.com/?tab=series&id=${rs.tvdbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {rs.tvdbId} <ExternalLink className="w-3 h-3" />
                        </a>
                      </TableCell>
                      <TableCell>{getStrategyBadge(rs.matchingStrategy)}</TableCell>
                      <TableCell>{rs.source === "local" ? "Lokal" : "Community"}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditing(rs);
                            setMessage(null);
                          }}
                        >
                          Bearbeiten
                        </Button>
                        <Button
                          disabled={rs.source !== "local"}
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm({ show: true, ruleset: rs })}
                          title="Löschen"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirm.show}
        onOpenChange={(open) => !open && setDeleteConfirm({ show: false, ruleset: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ruleset löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du das Ruleset für &quot;{deleteConfirm.ruleset?.topic}&quot; wirklich
              löschen? Danach gelten wieder die Community-Regeln für dieses Thema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
