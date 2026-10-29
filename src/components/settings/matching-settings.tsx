"use client";

import { SaveButton, type SettingsForm } from "@/components/settings/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/checkbox";
import { Field, ToggleRow } from "@/components/shared/field";

export function MatchingSettings({ form }: { form: SettingsForm }) {
  const { getFieldValue, setFieldValue, save: handleSave, isSaving } = form;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Matching</CardTitle>
        <CardDescription>Wie Mediathek-Treffer Serien und Folgen zugeordnet werden</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Matching-Strategie"
          hint="Fuzzy erlaubt ähnliche Titel, Strict nur exakte Übereinstimmungen."
        >
          {(id) => (
            <Select
              id={id}
              value={getFieldValue("matching.strategy")}
              onChange={(e) => setFieldValue("matching.strategy", e.target.value)}
            >
              <option value="fuzzy">Fuzzy (flexibel)</option>
              <option value="strict">Strict (exakt)</option>
            </Select>
          )}
        </Field>
        <Field label="Schwellwert" hint="0.0 = sehr locker, 1.0 = exakte Übereinstimmung.">
          {(id) => (
            <Input
              id={id}
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={getFieldValue("matching.threshold")}
              onChange={(e) => setFieldValue("matching.threshold", e.target.value)}
              className="w-32"
            />
          )}
        </Field>
        <Field label="Mindestdauer (Sekunden)" hint="Kürzere Videos werden ignoriert.">
          {(id) => (
            <Input
              id={id}
              type="number"
              value={getFieldValue("matching.minDuration")}
              onChange={(e) => setFieldValue("matching.minDuration", e.target.value)}
              className="w-32"
            />
          )}
        </Field>
        <ToggleRow
          label="Seriennamen für Sonarr normalisieren"
          hint="Schreibt Umlaute in Seriennamen ohne e (ö → o statt oe), damit Sonarr Releases von Serien wie Löwenzahn zuordnen kann."
          control={
            <Switch
              checked={getFieldValue("matching.normalizeSeriesNamesForSonarr") === "true"}
              onChange={(e) =>
                setFieldValue("matching.normalizeSeriesNamesForSonarr", String(e.target.checked))
              }
            />
          }
        />
        <SaveButton
          saving={isSaving}
          onClick={() =>
            handleSave([
              "matching.strategy",
              "matching.threshold",
              "matching.minDuration",
              "matching.normalizeSeriesNamesForSonarr",
            ])
          }
        />
      </CardContent>
    </Card>
  );
}
