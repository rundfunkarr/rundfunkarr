"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/notice";
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
  const matched = preview?.results.filter((result) => result.status === "matched").length ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span ref={heading} tabIndex={-1} className="outline-none">
            {initial ? "Regel bearbeiten und prüfen" : "Eigene Regel anlegen"}
          </span>
        </CardTitle>
        <CardDescription>
          Ordne ein Mediathek-Thema einer Serie zu und prüfe die Regel vor dem Speichern an bis zu
          30 aktuellen Treffern.
        </CardDescription>
        {initial?.id?.startsWith("community-") && (
          <Notice tone="info" className="mt-2">
            Beim Speichern entsteht eine lokale Regel, die die Community-Regeln für dieses Thema und
            diese Serie ersetzt.
          </Notice>
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
            <Field label="Mediathek-Thema" htmlFor="rule-topic">
              <Input
                id="rule-topic"
                required
                value={draft.topic}
                onChange={(event) => update("topic", event.target.value)}
                placeholder="Zum Beispiel Checker Reportagen"
              />
            </Field>
            <Field label="TVDB-ID" htmlFor="rule-tvdb">
              <Input
                id="rule-tvdb"
                type="number"
                min={1}
                max={2147483647}
                required
                className="font-mono"
                value={draft.tvdbId || ""}
                onChange={(event) => update("tvdbId", Number(event.target.value))}
                placeholder="Zum Beispiel 273716"
              />
            </Field>
            <Field label="Zuordnung" htmlFor="rule-strategy" className="md:col-span-2">
              <Select
                id="rule-strategy"
                value={draft.matchingStrategy}
                onChange={(event) =>
                  update("matchingStrategy", event.target.value as RulesetInput["matchingStrategy"])
                }
              >
                {Object.entries(strategies).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Staffel-Ausdruck"
              htmlFor="rule-season"
              hint="Für Nummernzuordnung: Staffel in der ersten Klammergruppe erfassen."
            >
              <Input
                id="rule-season"
                className="font-mono"
                value={draft.seasonRegex}
                onChange={(event) => update("seasonRegex", event.target.value)}
                placeholder="S(\d+)"
              />
            </Field>
            <Field
              label="Episoden-Ausdruck"
              htmlFor="rule-episode"
              hint="Für Nummernzuordnung: Episode in der ersten Klammergruppe erfassen."
            >
              <Input
                id="rule-episode"
                className="font-mono"
                value={draft.episodeRegex}
                onChange={(event) => update("episodeRegex", event.target.value)}
                placeholder="E(\d+)"
              />
            </Field>
            <Field
              label="Filter als JSON"
              htmlFor="rule-filters"
              hint={
                <>
                  Beispiel:{" "}
                  <code>{`[{"attribute":"duration","type":"GreaterThan","value":"15"}]`}</code> –
                  Laufzeitwerte in Minuten.
                </>
              }
            >
              <Textarea
                id="rule-filters"
                rows={5}
                value={draft.filters}
                onChange={(event) => update("filters", event.target.value)}
                className="font-mono text-xs"
              />
            </Field>
            <Field
              label="Titelregeln als JSON"
              htmlFor="rule-title"
              hint="Der Ausdruck ermittelt den Titel oder das Datum, das mit den Episodenmetadaten verglichen wird."
            >
              <Textarea
                id="rule-title"
                rows={5}
                value={draft.titleRegexRules}
                onChange={(event) => update("titleRegexRules", event.target.value)}
                className="font-mono text-xs"
              />
            </Field>
          </fieldset>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy !== null}>
              {busy === "save" ? "Wird gespeichert…" : "Lokal speichern"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !draft.topic.trim() || !draft.tvdbId}
              onClick={() => void submit("preview")}
            >
              {busy === "preview" ? "Treffer werden geprüft…" : "Live-Treffer prüfen"}
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
              {preview.show}: {matched} von {preview.results.length} Treffern zugeordnet
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
            <div className="space-y-2">
              {preview.results.map((result, index) => (
                <article key={`${result.url}-${index}`} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-medium leading-snug">{result.title}</h4>
                    {result.status === "matched" ? (
                      <Badge variant="ok">Zugeordnet</Badge>
                    ) : result.status === "filtered" ? (
                      <Badge variant="muted">Ausgefiltert</Badge>
                    ) : (
                      <Badge variant="warn">Nicht zugeordnet</Badge>
                    )}
                  </div>
                  <p className="tabular mt-1 text-xs text-muted-foreground">
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
