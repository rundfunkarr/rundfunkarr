"use client";

import { SaveButton, type SettingsForm } from "@/components/settings/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ToggleRow } from "@/components/shared/field";

export function DisplaySettings({ form }: { form: SettingsForm }) {
  const { getFieldValue, setFieldValue, save: handleSave, isSaving } = form;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Farbschema</CardTitle>
          <CardDescription>
            Gilt nur für diesen Browser und wird sofort übernommen. „System“ folgt der hellen oder
            dunklen Einstellung des Geräts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle showLabels />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bilder</CardTitle>
          <CardDescription>Gilt für alle Browser, die diese Instanz verwenden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Vorschaubilder in Suche, Filmen und Suchabos"
            hint="RundfunkArr ruft die Sendungsseite des Senders einmal ab, merkt sich die Bildadresse und zeigt das Bild direkt aus dem Netz des Senders. SRF liefert Bilder über seine API. Ausgeschaltet ruft RundfunkArr keine Sendungsseiten ab, und die Trefferlisten bleiben reine Textlisten."
            control={
              <Switch
                checked={getFieldValue("search.thumbnails") !== "false"}
                onChange={(e) => setFieldValue("search.thumbnails", String(e.target.checked))}
              />
            }
          />
          <ToggleRow
            label="Serienposter in Serien und Rulesets"
            hint="Poster aus TVDB, die beim Abgleich mit Sonarr ohnehin mitgeladen werden. Der Browser lädt sie vom Bildserver von TVDB."
            control={
              <Switch
                checked={getFieldValue("ui.posters") !== "false"}
                onChange={(e) => setFieldValue("ui.posters", String(e.target.checked))}
              />
            }
          />
          <SaveButton
            saving={isSaving}
            onClick={() => handleSave(["search.thumbnails", "ui.posters"])}
          />
        </CardContent>
      </Card>
    </>
  );
}
