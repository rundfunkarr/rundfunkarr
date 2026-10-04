"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RulesetInput } from "@/lib/ruleset-input";
import type { RuleDiagnosis } from "@/services/mediathek";

const empty: RulesetInput = {
  topic: "",
  tvdbId: 0,
  matchingStrategy: "ItemTitleExact",
  filters: "[]",
  titleRegexRules: '[{"type":"regex","field":"title","pattern":"(.*)"}]',
  seasonRegex: "",
  episodeRegex: "",
};
const strategies = {
  SeasonAndEpisodeNumber: "Staffel- und Episodennummer",
  ItemTitleIncludes: "Episodentitel enthält den ermittelten Titel",
  ItemTitleExact: "Episodentitel vergleichen",
  ItemTitleEqualsAirdate: "Ausstrahlungsdatum",
};

export function RulesetEditor({
  initial,
  onSaved,
  onClose,
}: {
  initial: RulesetInput | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RulesetInput>(initial ?? empty);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ show: string; results: RuleDiagnosis[] } | null>(null);
  const heading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const update = <K extends keyof RulesetInput>(key: K, value: RulesetInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setError(null);
  };
  const submit = async (mode: "preview" | "save") => {
    setBusy(mode);
    setError(null);
    try {
      const response = await fetch(mode === "preview" ? "/api/rulesets/preview" : "/api/rulesets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Die Anfrage ist fehlgeschlagen.");
      if (mode === "preview") setPreview(data);
      else onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Die Anfrage ist fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span ref={heading} tabIndex={-1} className="outline-none">
            {initial ? "Regel bearbeiten und prüfen" : "Eigene Regel anlegen"}
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Ordne ein Mediathek-Thema einer Serie zu und prüfe die Regel vor dem Speichern an bis zu
          30 aktuellen Treffern.
        </p>
        {initial?.id?.startsWith("community-") && (
          <p className="text-sm">
            Beim Speichern entsteht eine lokale Regel, die die Community-Regeln für dieses Thema und
            diese Serie ersetzt.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit("save");
          }}
          className="space-y-5"
        >
          <fieldset
            disabled={busy !== null}
            className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
          >
            <div>
              <label htmlFor="rule-topic" className="text-sm font-medium">
                Mediathek-Thema
              </label>
              <Input
                id="rule-topic"
                required
                value={draft.topic}
                onChange={(event) => update("topic", event.target.value)}
                placeholder="Zum Beispiel Checker Reportagen"
              />
            </div>
            <div>
              <label htmlFor="rule-tvdb" className="text-sm font-medium">
                TVDB-ID
              </label>
              <Input
                id="rule-tvdb"
                type="number"
                min={1}
                max={2147483647}
                required
                value={draft.tvdbId || ""}
                onChange={(event) => update("tvdbId", Number(event.target.value))}
                placeholder="Zum Beispiel 273716"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="rule-strategy" className="text-sm font-medium">
                Zuordnung
              </label>
              <select
                id="rule-strategy"
                value={draft.matchingStrategy}
                onChange={(event) =>
                  update("matchingStrategy", event.target.value as RulesetInput["matchingStrategy"])
                }
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
              >
                {Object.entries(strategies).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rule-season" className="text-sm font-medium">
                Staffel-Ausdruck
              </label>
              <Input
                id="rule-season"
                className="font-mono"
                value={draft.seasonRegex}
                onChange={(event) => update("seasonRegex", event.target.value)}
                placeholder="S(\d+)"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Für Nummernzuordnung: Staffel in der ersten Klammergruppe erfassen.
              </p>
            </div>
            <div>
              <label htmlFor="rule-episode" className="text-sm font-medium">
                Episoden-Ausdruck
              </label>
              <Input
                id="rule-episode"
                className="font-mono"
                value={draft.episodeRegex}
                onChange={(event) => update("episodeRegex", event.target.value)}
                placeholder="E(\d+)"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Für Nummernzuordnung: Episode in der ersten Klammergruppe erfassen.
              </p>
            </div>
            <div>
              <label htmlFor="rule-filters" className="text-sm font-medium">
                Filter als JSON
              </label>
              <textarea
                id="rule-filters"
                rows={5}
                value={draft.filters}
                onChange={(event) => update("filters", event.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-3 font-mono text-xs focus-visible:outline-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Beispiel: {`[{"attribute":"duration","type":"GreaterThan","value":"15"}]`} —
                Laufzeitwerte in Minuten.
              </p>
            </div>
            <div>
              <label htmlFor="rule-title" className="text-sm font-medium">
                Titelregeln als JSON
              </label>
              <textarea
                id="rule-title"
                rows={5}
                value={draft.titleRegexRules}
                onChange={(event) => update("titleRegexRules", event.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-3 font-mono text-xs focus-visible:outline-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Der Ausdruck ermittelt den Titel oder das Datum, das mit den Episodenmetadaten
                verglichen wird.
              </p>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !draft.topic.trim() || !draft.tvdbId}
              onClick={() => void submit("preview")}
            >
              {busy === "preview" ? "Treffer werden geprüft…" : "Live-Treffer prüfen"}
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === "save" ? "Wird gespeichert…" : "Lokal speichern"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={onClose}>
              Schließen
            </Button>
          </div>
        </form>
        {preview && (
          <section
            className="mt-6 border-t pt-5"
            aria-label="Ergebnis der Matching-Vorschau"
            aria-live="polite"
          >
            <h3 className="font-semibold">
              {preview.show}:{" "}
              {preview.results.filter((result) => result.status === "matched").length} von{" "}
              {preview.results.length} Treffern zugeordnet
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Die Vorschau speichert die Regel nicht. Globale Laufzeit- und HLS-Einstellungen gelten
              auch hier.
            </p>
            {preview.results.length === 0 && (
              <p className="text-sm">
                Keine Treffer für dieses Thema. Schreibweise und aktivierte Quellen prüfen.
              </p>
            )}
            <div className="space-y-3">
              {preview.results.map((result, index) => (
                <article key={`${result.url}-${index}`} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-medium">{result.title}</h4>
                    <span
                      className={`rounded px-2 py-1 text-xs ${result.status === "matched" ? "bg-green-600/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                    >
                      {result.status === "matched"
                        ? "Zugeordnet"
                        : result.status === "filtered"
                          ? "Ausgefiltert"
                          : "Nicht zugeordnet"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.topic} · {Math.round(result.duration / 60)} Minuten
                  </p>
                  <p className="mt-2 text-sm">{result.reason}</p>
                  {result.episode && (
                    <p className="mt-1 text-sm font-medium">
                      Staffel {result.episode.season}, Folge {result.episode.episode}:{" "}
                      {result.episode.title}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
