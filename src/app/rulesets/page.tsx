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
import { Page, PageHeader } from "@/components/shared/page";
import { Notice } from "@/components/shared/notice";
import { EmptyState } from "@/components/shared/empty-state";
import { Thumbnail } from "@/components/shared/thumbnail";
import { RefreshCw, Search, Settings2, Trash2, ExternalLink, Plus } from "lucide-react";

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
  image: string | null;
  source: "local" | "community";
}

const strategyLabels: Record<string, string> = {
  SeasonAndEpisodeNumber: "Staffel + Episode",
  ItemTitleExact: "Episodentitel",
  ItemTitleIncludes: "Episodentitel (enthält)",
  ItemTitleEqualsAirdate: "Ausstrahlungsdatum",
};

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

  return (
    <Page>
      <PageHeader
        title="Rulesets"
        description="Regeln, die Mediathek-Themen einer Serie zuordnen und Folgen erkennen."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={fetchRulesets}>
              <RefreshCw />
              Aktualisieren
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setMessage(null);
              }}
            >
              <Plus />
              Eigene Regel anlegen
            </Button>
          </>
        }
      />

      {message && <Notice tone="ok">{message}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
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

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            {filteredRulesets.length} Rulesets
          </CardTitle>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Rulesets durchsuchen</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Thema oder Serie suchen…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </label>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Wird geladen…</p>
          ) : filteredRulesets.length === 0 ? (
            <EmptyState
              icon={Settings2}
              title={rulesets.length === 0 ? "Noch keine Rulesets" : "Keine Rulesets gefunden"}
              description={
                rulesets.length === 0
                  ? "Rulesets entstehen automatisch, sobald Sonarr nach Serien sucht. Eigene Regeln lassen sich jederzeit anlegen."
                  : "Für diese Suche gibt es kein passendes Ruleset."
              }
            />
          ) : (
            <Table scrollLabel="Rulesets" className="min-w-[52rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Thema</TableHead>
                  <TableHead>Serie</TableHead>
                  <TableHead>TVDB-ID</TableHead>
                  <TableHead>Zuordnung</TableHead>
                  <TableHead>Quelle</TableHead>
                  <TableHead className="w-36 text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRulesets.map((rs) => (
                  <TableRow key={rs.id}>
                    <TableCell className="font-medium">{rs.topic}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Thumbnail src={rs.image} ratio="poster" className="w-7" always />
                        <div className="min-w-0">
                          <span className="block">{rs.showName}</span>
                          {rs.germanName && (
                            <span className="block text-xs text-muted-foreground">
                              {rs.germanName}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <a
                        href={`https://thetvdb.com/?tab=series&id=${rs.tvdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tabular inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {rs.tvdbId} <ExternalLink className="size-3" />
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {strategyLabels[rs.matchingStrategy] ?? rs.matchingStrategy}
                    </TableCell>
                    <TableCell>
                      {rs.source === "local" ? (
                        <Badge variant="secondary">Lokal</Badge>
                      ) : (
                        <Badge variant="muted">Community</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(rs);
                            setMessage(null);
                          }}
                        >
                          Bearbeiten
                        </Button>
                        {rs.source === "local" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-danger"
                            onClick={() => setDeleteConfirm({ show: true, ruleset: rs })}
                            title="Löschen"
                            aria-label={`Löschen: ${rs.topic}`}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteConfirm.show}
        onOpenChange={(open) => !open && setDeleteConfirm({ show: false, ruleset: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ruleset löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du das Ruleset für „{deleteConfirm.ruleset?.topic}“ wirklich löschen? Danach
              gelten wieder die Community-Regeln für dieses Thema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
