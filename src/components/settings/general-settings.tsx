"use client";

import { SecuritySettings } from "@/components/auth/security-settings";
import { FilmlisteIndexSettings } from "@/components/settings/filmliste-index-settings";
import { PostProcessSettings } from "@/components/settings/post-process-settings";
import { SaveButton, type SettingsForm } from "@/components/settings/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/checkbox";
import { Field, ToggleRow } from "@/components/shared/field";

export function GeneralSettings({ form }: { form: SettingsForm }) {
  const { getFieldValue, setFieldValue, save: handleSave, isSaving } = form;

  return (
    <>
      <SecuritySettings />
      <Card>
        <CardHeader>
          <CardTitle>Downloads</CardTitle>
          <CardDescription>Zielordner, Qualität, Untertitel und Fassungen</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Download-Pfad" hint="Verzeichnis für heruntergeladene Dateien.">
            {(id) => (
              <Input
                id={id}
                value={getFieldValue("download.path")}
                onChange={(e) => setFieldValue("download.path", e.target.value)}
                placeholder="/downloads"
                className="font-mono text-xs md:text-xs"
              />
            )}
          </Field>
          <Field
            label="Bevorzugte Qualität"
            hint="Welche Qualitäten im Newznab-Feed angeboten werden."
          >
            {(id) => (
              <Select
                id={id}
                value={getFieldValue("download.quality")}
                onChange={(e) => setFieldValue("download.quality", e.target.value)}
              >
                <option value="all">Alle Qualitäten</option>
                <option value="best">Nur beste verfügbare</option>
                <option value="1080p">Nur 1080p (Full HD)</option>
                <option value="720p">Nur 720p (HD)</option>
                <option value="480p">Nur 480p (SD)</option>
              </Select>
            )}
          </Field>
          <Field
            label="Untertitel"
            htmlFor="subtitle-mode"
            hint="Nutzt die von der Mediathek bereitgestellten Untertitel. SRT, WebVTT und TTML werden unterstützt. Wenn Einbetten scheitert, bleibt die SRT-Datei erhalten und die Historie zeigt den Hinweis."
          >
            <Select
              id="subtitle-mode"
              value={getFieldValue("download.subtitleMode") || "off"}
              onChange={(e) => setFieldValue("download.subtitleMode", e.target.value)}
            >
              <option value="off">Nicht herunterladen</option>
              <option value="sidecar">Als SRT-Datei daneben speichern</option>
              <option value="embed">In MKV oder MP4 einbetten</option>
            </Select>
          </Field>
          <Field
            label="Fassungen in Suche und Feed"
            htmlFor="audio-variant"
            hint="Erkennt Fassungen anhand der Titelangaben. Die tatsächliche Audiosprache wird dabei nicht ermittelt. Vorhandene Sprachangaben bleiben beim Konvertieren erhalten. Im Release-Titel stehen Originalfassungen als ORIGINAL und Audiodeskriptionen als GERMAN.AD."
          >
            <Select
              id="audio-variant"
              value={getFieldValue("matching.audioVariant") || "all"}
              onChange={(e) => setFieldValue("matching.audioVariant", e.target.value)}
            >
              <option value="all">Alle Fassungen</option>
              <option value="standard">Standardfassung</option>
              <option value="original">Originalfassung / OmU</option>
              <option value="description">Audiodeskription / Hörfassung</option>
            </Select>
          </Field>
          <ToggleRow
            label="MP4 in MKV konvertieren"
            hint="Deaktivieren, wenn ein externes Tool wie Tdarr die Medienverarbeitung übernimmt. Heruntergeladene MP4-Dateien bleiben dann unverändert."
            control={
              <Switch
                checked={getFieldValue("download.convertToMkv") !== "false"}
                onChange={(e) => setFieldValue("download.convertToMkv", String(e.target.checked))}
              />
            }
          />
          <SaveButton
            saving={isSaving}
            onClick={() =>
              handleSave([
                "download.path",
                "download.quality",
                "download.convertToMkv",
                "download.subtitleMode",
                "matching.audioVariant",
              ])
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Streaming</CardTitle>
          <CardDescription>HLS-Streams, ORF-Suche, yt-dlp und Proxy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="HLS-Streams aktivieren"
            hint="Ermöglicht das Herunterladen von HLS-Streams, zum Beispiel von SRF und ORF."
            control={
              <Switch
                checked={getFieldValue("download.enableHLS") === "true"}
                onChange={(e) => setFieldValue("download.enableHLS", String(e.target.checked))}
              />
            }
          />
          <ToggleRow
            label="ORF-Suche aktivieren"
            hint="Bezieht ORF-Treffer aus MediathekView ein. Benötigt HLS. Viele ORF-Sendungen sind nur in Österreich abrufbar."
            control={
              <Switch
                checked={getFieldValue("provider.orf.enabled") === "true"}
                onChange={(e) => setFieldValue("provider.orf.enabled", String(e.target.checked))}
              />
            }
          />
          <Field
            label="yt-dlp-Pfad (optional)"
            hint="Pfad zur yt-dlp-Binary. Leer lassen für den geprüften automatischen Download."
          >
            {(id) => (
              <Input
                id={id}
                value={getFieldValue("download.ytdlpPath")}
                onChange={(e) => setFieldValue("download.ytdlpPath", e.target.value)}
                placeholder="Leer = automatischer Download"
                className="font-mono text-xs md:text-xs"
              />
            )}
          </Field>
          <Field
            label="Proxy-URL (optional)"
            hint="Optionaler Proxy für yt-dlp und Downloads. Unterstützt HTTP, HTTPS, SOCKS4 und SOCKS5."
          >
            {(id) => (
              <Input
                id={id}
                value={getFieldValue("download.proxyUrl")}
                onChange={(e) => setFieldValue("download.proxyUrl", e.target.value)}
                placeholder="socks5://localhost:1080"
                className="font-mono text-xs md:text-xs"
              />
            )}
          </Field>
          <SaveButton
            saving={isSaving}
            onClick={() =>
              handleSave([
                "download.enableHLS",
                "download.ytdlpPath",
                "download.proxyUrl",
                "provider.orf.enabled",
              ])
            }
          />
        </CardContent>
      </Card>

      <PostProcessSettings />

      <FilmlisteIndexSettings />
    </>
  );
}
